#!/usr/bin/env bash
set -euo pipefail

# deploy.sh — push ptlabel-server + static UI to a running Pi over SSH.
# No reflash. Defaults to binary+static; --static-only skips the Rust build.
#
# usage:
#   ./deploy.sh                       defaults to root@192.168.4.58
#   ./deploy.sh --static-only         skip Rust build, just push UI (fast)
#   ./deploy.sh root@192.168.1.42     pick another host
#
# env:
#   PI_HOST  override default host (overridden again by positional arg)
#   PI_PASS  override default ssh password (default: ptlabel)

ROOT="$(cd "$(dirname "$0")" && pwd)"
STATIC_ONLY=0
HOST=""
for arg in "$@"; do
  case "$arg" in
    --static-only) STATIC_ONLY=1 ;;
    *) HOST="$arg" ;;
  esac
done
HOST="${HOST:-${PI_HOST:-root@192.168.4.58}}"
PASS="${PI_PASS:-ptlabel}"

if ! command -v sshpass >/dev/null; then
  echo "sshpass missing; install with: brew install hudochenkov/sshpass/sshpass" >&2
  exit 1
fi

SSH_OPTS=(-o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR)

if [[ $STATIC_ONLY -eq 0 ]]; then
  "${ROOT}/scripts/br-build-flash.sh" --rust-only

  BIN="${ROOT}/.cache/ptlabel-server/bin/ptlabel-server"
  if [[ ! -f "$BIN" ]]; then
    echo "build did not produce $BIN" >&2
    exit 1
  fi

  SIZE_KB=$(( $(stat -f %z "$BIN") / 1024 ))
  echo "==> pushing ${SIZE_KB} KB binary to ${HOST}"
  sshpass -p "$PASS" scp -O "${SSH_OPTS[@]}" "$BIN" "${HOST}:/opt/ptlabel/bin/ptlabel-server.new"
fi

if [[ ! -f "${ROOT}/icons/category-sprite.png" ]]; then
  echo "icons/category-sprite.png missing; run: python3 scripts/build-icon-catalog.py" >&2
  exit 1
fi

echo "==> building static bundle (astro + precompress)"
( cd "$ROOT" && bun run build )

DIST="${ROOT}/static"
if [[ ! -d "$DIST" ]]; then
  echo "build did not produce $DIST" >&2
  exit 1
fi

echo "==> pushing static/ to ${HOST}"
sshpass -p "$PASS" scp -O -r "${SSH_OPTS[@]}" "$DIST" "${HOST}:/opt/ptlabel/static.new"

echo "==> pushing icon catalog + sprite to ${HOST}"
sshpass -p "$PASS" scp -O "${SSH_OPTS[@]}" \
  "${ROOT}/icons/catalog.json" \
  "${ROOT}/icons/catalog.json.br" \
  "${ROOT}/icons/catalog.json.gz" \
  "${ROOT}/icons/category-sprite.png" \
  "${HOST}:/opt/ptlabel/icons/"

echo "==> pushing init/diag overlay files to ${HOST}"
OVERLAY="${ROOT}/buildroot-external/board/ptlabel-pi0/overlay"
sshpass -p "$PASS" scp -O "${SSH_OPTS[@]}" \
  "${OVERLAY}/etc/init.d/S50ptlabel" \
  "${HOST}:/etc/init.d/S50ptlabel"
sshpass -p "$PASS" scp -O "${SSH_OPTS[@]}" \
  "${OVERLAY}/etc/default/ptlabel" \
  "${HOST}:/etc/default/ptlabel"
sshpass -p "$PASS" scp -O "${SSH_OPTS[@]}" \
  "${OVERLAY}/usr/bin/ptlabel-diagnostics" \
  "${HOST}:/usr/bin/ptlabel-diagnostics"

echo "==> generating + pushing TLS cert"
HOST_IP="${HOST##*@}"
TLS_CACHE="${ROOT}/.cache/tls/${HOST_IP}"
mkdir -p "$TLS_CACHE"
PTLABEL_MDNS_NAME=label PTLABEL_HOSTNAME=ptlabel-pi0 \
  "${ROOT}/scripts/gen-tls-cert.sh" "$TLS_CACHE" "$HOST_IP"
sshpass -p "$PASS" ssh "${SSH_OPTS[@]}" "$HOST" 'mkdir -p /opt/ptlabel/data/tls && chmod 700 /opt/ptlabel/data/tls'
sshpass -p "$PASS" scp -O "${SSH_OPTS[@]}" \
  "$TLS_CACHE/leaf.pem" "$TLS_CACHE/leaf.key.pem" \
  "${HOST}:/opt/ptlabel/data/tls/"

sshpass -p "$PASS" ssh "${SSH_OPTS[@]}" "$HOST" \
  STATIC_ONLY="$STATIC_ONLY" bash -s <<'EOS'
set -e
if [ "$STATIC_ONLY" = "0" ]; then
  chmod +x /opt/ptlabel/bin/ptlabel-server.new
  mv /opt/ptlabel/bin/ptlabel-server.new /opt/ptlabel/bin/ptlabel-server
fi
chmod +x /etc/init.d/S50ptlabel /usr/bin/ptlabel-diagnostics
chmod 600 /opt/ptlabel/data/tls/leaf.key.pem
chmod 644 /opt/ptlabel/data/tls/leaf.pem
rm -rf /opt/ptlabel/static.old
[ -d /opt/ptlabel/static ] && mv /opt/ptlabel/static /opt/ptlabel/static.old
mv /opt/ptlabel/static.new /opt/ptlabel/static
rm -rf /opt/ptlabel/static.old
/etc/init.d/S50ptlabel restart
sleep 3
echo "--- ps ---"
ps w | grep ptlabel-server | grep -v grep || echo "ptlabel-server not running"
echo "--- listening ports ---"
ss -lnt 2>/dev/null | awk 'NR==1 || /:(80|443)\b/' || netstat -lnt 2>/dev/null | awk 'NR<3 || /:(80|443)\b/'
echo "--- /api/status (via :80 redirect) ---"
curl -fsS --max-time 3 -o /dev/null -w 'http=%{http_code} -> %{redirect_url}\n' http://127.0.0.1/api/status || echo "redirect probe failed"
echo "--- mdns advertisement ---"
grep -i mdns /var/log/ptlabel/server.log | tail -3 || true
echo "--- server log ---"
tail -n 8 /var/log/ptlabel/server.log 2>/dev/null || echo "(empty log)"
EOS

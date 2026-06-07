#!/usr/bin/env bash
set -euo pipefail

# deploy.sh — push ptlabel-server + static UI to a running Pi over SSH.
# No reflash. Defaults to binary+static; --static-only skips the Rust build.
#
# Auth is pubkey only. Bootstrap once with:
#   ssh-copy-id -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null root@192.168.4.58
#
# usage:
#   ./deploy.sh                       defaults to root@192.168.4.58
#   ./deploy.sh --static-only         skip Rust build, just push UI (fast)
#   ./deploy.sh --device label        load devices/label.env
#   ./deploy.sh root@192.168.1.42     pick another host
#
# env:
#   PI_HOST  override default host (overridden again by positional arg)

ROOT="$(cd "$(dirname "$0")" && pwd)"
STATIC_ONLY=0
HOST=""
DEVICE=""
DEFAULTS_FILE=""

load_device() {
  local device_name="$1"
  local device_file="${ROOT}/devices/${device_name}.env"
  if [[ ! -f "$device_file" ]]; then
    echo "device profile not found: $device_file" >&2
    exit 1
  fi
  set -a
  # shellcheck source=/dev/null
  . "$device_file"
  set +a
}
while [[ $# -gt 0 ]]; do
  case "$1" in
    --static-only) STATIC_ONLY=1; shift ;;
    --device)
      DEVICE="${2:-}"
      if [[ -z "$DEVICE" ]]; then
        echo "--device requires a value" >&2
        exit 1
      fi
      shift 2
      ;;
    --device=*) DEVICE="${1#--device=}"; shift ;;
    *) HOST="$1"; shift ;;
  esac
done
if [[ -n "$DEVICE" ]]; then
  load_device "$DEVICE"
fi
PTLABEL_MDNS_NAME="${PTLABEL_MDNS_NAME:-label}"
PTLABEL_PORT="${PTLABEL_PORT:-80}"
PTLABEL_DIAGNOSTICS="${PTLABEL_DIAGNOSTICS:-0}"
PTLABEL_STATIC_IPV4="${PTLABEL_STATIC_IPV4:-}"
PTLABEL_STATIC_GW="${PTLABEL_STATIC_GW:-}"
PTLABEL_STATIC_DNS="${PTLABEL_STATIC_DNS:-}"
HOST="${HOST:-${PI_HOST:-root@192.168.4.58}}"

SSH_OPTS=(-o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR -o BatchMode=yes)

if [[ $STATIC_ONLY -eq 0 ]]; then
  "${ROOT}/scripts/br-build-flash.sh" --rust-only

  BIN="${ROOT}/.cache/ptlabel-server/bin/ptlabel-server"
  if [[ ! -f "$BIN" ]]; then
    echo "build did not produce $BIN" >&2
    exit 1
  fi

  SIZE_KB=$(( $(stat -f %z "$BIN") / 1024 ))
  echo "==> pushing ${SIZE_KB} KB binary to ${HOST}"
  scp -O "${SSH_OPTS[@]}" "$BIN" "${HOST}:/opt/ptlabel/bin/ptlabel-server.new"
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
scp -O -r "${SSH_OPTS[@]}" "$DIST" "${HOST}:/opt/ptlabel/static.new"

echo "==> pushing icon catalog + sprite to ${HOST}"
scp -O "${SSH_OPTS[@]}" \
  "${ROOT}/icons/catalog.json" \
  "${ROOT}/icons/catalog.json.br" \
  "${ROOT}/icons/catalog.json.gz" \
  "${ROOT}/icons/category-sprite.png" \
  "${HOST}:/opt/ptlabel/icons/"

echo "==> pushing init/diag overlay files to ${HOST}"
OVERLAY="${ROOT}/buildroot-external/board/ptlabel-pi0/overlay"
scp -O "${SSH_OPTS[@]}" \
  "${OVERLAY}/etc/init.d/S20ptlabel" \
  "${HOST}:/etc/init.d/S20ptlabel"
scp -O "${SSH_OPTS[@]}" \
  "${OVERLAY}/etc/init.d/S35wifi" \
  "${HOST}:/etc/init.d/S35wifi"
scp -O "${SSH_OPTS[@]}" \
  "${OVERLAY}/etc/init.d/S60ptlabel-diagnostics" \
  "${HOST}:/etc/init.d/S60ptlabel-diagnostics"
DEFAULTS_FILE="$(mktemp)"
trap 'rm -f "$DEFAULTS_FILE"' EXIT
cat >"$DEFAULTS_FILE" <<EOF
PTLABEL_ROOT=/opt/ptlabel
PTLABEL_DATA_DIR=/opt/ptlabel/data
PTLABEL_PORT=${PTLABEL_PORT}
PTLABEL_MDNS_NAME=${PTLABEL_MDNS_NAME}
PTLABEL_DIAGNOSTICS=${PTLABEL_DIAGNOSTICS}
PTLABEL_STATIC_IPV4=${PTLABEL_STATIC_IPV4}
PTLABEL_STATIC_GW=${PTLABEL_STATIC_GW}
PTLABEL_STATIC_DNS=${PTLABEL_STATIC_DNS}
EOF
scp -O "${SSH_OPTS[@]}" \
  "$DEFAULTS_FILE" \
  "${HOST}:/etc/default/ptlabel"
scp -O "${SSH_OPTS[@]}" \
  "${OVERLAY}/usr/bin/ptlabel-diagnostics" \
  "${HOST}:/usr/bin/ptlabel-diagnostics"

ssh "${SSH_OPTS[@]}" "$HOST" \
  STATIC_ONLY="$STATIC_ONLY" bash -s <<'EOS'
set -e
if [ "$STATIC_ONLY" = "0" ]; then
  chmod +x /opt/ptlabel/bin/ptlabel-server.new
  mv /opt/ptlabel/bin/ptlabel-server.new /opt/ptlabel/bin/ptlabel-server
fi
chmod +x /etc/init.d/S20ptlabel /etc/init.d/S35wifi /etc/init.d/S60ptlabel-diagnostics /usr/bin/ptlabel-diagnostics
rm -rf /opt/ptlabel/static.old
[ -d /opt/ptlabel/static ] && mv /opt/ptlabel/static /opt/ptlabel/static.old
mv /opt/ptlabel/static.new /opt/ptlabel/static
rm -rf /opt/ptlabel/static.old
/etc/init.d/S20ptlabel restart
/etc/init.d/S35wifi restart || true
/etc/init.d/S60ptlabel-diagnostics restart || true
sleep 3
echo "--- ps ---"
ps w | grep ptlabel-server | grep -v grep || echo "ptlabel-server not running"
echo "--- listening ports ---"
ss -lnt 2>/dev/null | awk 'NR==1 || /:80\b/' || netstat -lnt 2>/dev/null | awk 'NR<3 || /:80\b/'
echo "--- /api/status ---"
curl -fsS --max-time 3 http://127.0.0.1/api/status || echo "status probe failed"
echo "--- mdns advertisement ---"
grep -i mdns /var/log/ptlabel/server.log | tail -3 || true
echo "--- server log ---"
tail -n 8 /var/log/ptlabel/server.log 2>/dev/null || echo "(empty log)"
EOS

echo
echo "WARNING: kernel/firmware/buildroot config changes still require full image rebuild + reflash."
echo "Runtime deploy only updates app/static/overlay files on the running Pi."

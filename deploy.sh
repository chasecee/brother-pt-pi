#!/usr/bin/env bash
set -euo pipefail

# deploy.sh — build ptlabel-server for the Pi Zero W and push it to a running
# Pi over SSH, then restart the service. No reflash, no CI round-trip.
#
# usage:
#   ./deploy.sh                       defaults to root@192.168.4.58
#   ./deploy.sh root@192.168.1.42     pick another host
#
# env:
#   PI_HOST  override default host (overridden again by positional arg)
#   PI_PASS  override default ssh password (default: ptlabel)

ROOT="$(cd "$(dirname "$0")" && pwd)"
HOST="${1:-${PI_HOST:-root@192.168.4.58}}"
PASS="${PI_PASS:-ptlabel}"

if ! command -v sshpass >/dev/null; then
  echo "sshpass missing; install with: brew install hudochenkov/sshpass/sshpass" >&2
  exit 1
fi

"${ROOT}/scripts/br-build-flash.sh" --rust-only

BIN="${ROOT}/.cache/ptlabel-server/bin/ptlabel-server"
if [[ ! -f "$BIN" ]]; then
  echo "build did not produce $BIN" >&2
  exit 1
fi

SSH_OPTS=(-o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null)
SIZE_KB=$(( $(stat -f %z "$BIN") / 1024 ))
echo "==> deploying ${SIZE_KB} KB binary to ${HOST}"

sshpass -p "$PASS" scp -O "${SSH_OPTS[@]}" "$BIN" "${HOST}:/opt/ptlabel/bin/ptlabel-server.new"
sshpass -p "$PASS" ssh "${SSH_OPTS[@]}" "$HOST" bash -s <<'EOS'
set -e
chmod +x /opt/ptlabel/bin/ptlabel-server.new
mv /opt/ptlabel/bin/ptlabel-server.new /opt/ptlabel/bin/ptlabel-server
/etc/init.d/S50ptlabel restart
sleep 3
echo "--- ps ---"
ps w | grep ptlabel-server | grep -v grep || echo "ptlabel-server not running"
echo "--- /api/status ---"
curl -fsS --max-time 3 127.0.0.1:5000/api/status; echo
echo "--- server log ---"
tail -n 8 /var/log/ptlabel/server.log 2>/dev/null || echo "(empty log)"
EOS

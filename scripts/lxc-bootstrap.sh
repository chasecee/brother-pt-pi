#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEVICE=""
HOST=""

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
    --device)
      DEVICE="${2:-}"
      shift 2
      ;;
    --device=*)
      DEVICE="${1#--device=}"
      shift
      ;;
    *)
      HOST="$1"
      shift
      ;;
  esac
done

if [[ -n "$DEVICE" ]]; then
  load_device "$DEVICE"
fi

HOST="${HOST:-${PI_HOST:-}}"
if [[ -z "$HOST" ]]; then
  echo "missing host. pass root@ip or set PI_HOST in device profile" >&2
  exit 1
fi

SSH_OPTS=(-o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR)

echo "==> bootstrapping ${HOST}"
ssh-copy-id "${SSH_OPTS[@]}" "$HOST"
ssh "${SSH_OPTS[@]}" "$HOST" sh -s <<'EOS'
set -e
apk update
apk add --no-cache openrc curl avahi avahi-tools dbus jq rsync openssh
mkdir -p /opt/ptlabel/bin /opt/ptlabel/static /opt/ptlabel/data \
         /opt/ptlabel/icons /opt/ptlabel/fonts /etc/conf.d /var/log/ptlabel
touch /etc/conf.d/ptlabel
rc-update add dbus default >/dev/null 2>&1 || true
rc-update add avahi-daemon default >/dev/null 2>&1 || true
rc-service dbus start >/dev/null 2>&1 || true
rc-service avahi-daemon start >/dev/null 2>&1 || true
EOS

echo "==> bootstrap complete for ${HOST}"

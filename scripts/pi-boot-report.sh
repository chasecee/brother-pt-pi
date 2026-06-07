#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HOST=""
DEVICE=""

usage() {
  cat <<EOF
usage: $0 [--device NAME] [--host root@IP]

Examples:
  $0 --device labelbuddy
  $0 --host root@192.168.4.117
EOF
}

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
      [[ -n "$DEVICE" ]] || { echo "--device requires a value" >&2; exit 1; }
      shift 2
      ;;
    --device=*)
      DEVICE="${1#--device=}"
      shift
      ;;
    --host)
      HOST="${2:-}"
      [[ -n "$HOST" ]] || { echo "--host requires a value" >&2; exit 1; }
      shift 2
      ;;
    --host=*)
      HOST="${1#--host=}"
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "unknown arg: $1" >&2
      usage
      exit 1
      ;;
  esac
done

if [[ -n "$DEVICE" ]]; then
  load_device "$DEVICE"
fi
HOST="${HOST:-${PI_HOST:-}}"
if [[ -z "$HOST" ]]; then
  echo "host not set; pass --host or --device" >&2
  exit 1
fi

SSH_OPTS=(-o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR -o BatchMode=yes)

ssh "${SSH_OPTS[@]}" "$HOST" 'sh -s' <<'EOS'
set -eu
echo "== image info =="
if [ -f /etc/ptlabel-image-info ]; then
  cat /etc/ptlabel-image-info
else
  echo "missing /etc/ptlabel-image-info"
fi
echo
echo "== boot init milestones =="
if [ -f /var/log/ptlabel/boot.log ]; then
  cat /var/log/ptlabel/boot.log
else
  echo "missing /var/log/ptlabel/boot.log"
fi
echo
echo "== server start lines =="
if [ -f /var/log/ptlabel/server.log ]; then
  grep -E "bind-start|listening on|mdns:" /var/log/ptlabel/server.log | tail -n 20 || true
else
  echo "missing /var/log/ptlabel/server.log"
fi
echo
echo "== wifi timing lines =="
if [ -f /var/log/wifi.log ]; then
  grep -E "uptime=|associated|wlan0 ip|done" /var/log/wifi.log | tail -n 20 || true
else
  echo "missing /var/log/wifi.log"
fi
echo
echo "== kernel milestones =="
dmesg | grep -E "Run /sbin/init|VFS: Mounted root|brcmfmac: brcmf_c_preinit_dcmds|new high speed SDHC card|Waiting for root device" | tail -n 20 || true
EOS

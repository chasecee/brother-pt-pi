#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RULE=/etc/udev/rules.d/99-brother-pt710bt-usblp.rules

sudo cp "$ROOT/deploy/99-brother-pt710bt-usblp.rules" "$RULE"
sudo udevadm control --reload-rules
sudo udevadm trigger

if lsmod | grep -q '^usblp'; then
  sudo modprobe -r usblp || true
fi

for dev in /sys/bus/usb/drivers/usblp/*:*; do
  [[ -e "$dev" ]] || continue
  name="$(basename "$dev")"
  echo "$name" | sudo tee /sys/bus/usb/drivers/usblp/unbind >/dev/null 2>&1 || true
done

echo "usb setup done"

#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RULE=/etc/udev/rules.d/99-brother-pt710bt-usblp.rules
RUN_USER="${PTLABEL_USER:-$USER}"

sudo cp "$ROOT/deploy/99-brother-pt710bt-usblp.rules" "$RULE"
sudo getent group plugdev >/dev/null || sudo groupadd --system plugdev
sudo usermod -aG plugdev "$RUN_USER"
sudo udevadm control --reload-rules
sudo udevadm trigger --subsystem-match=usb --action=add
sudo udevadm trigger --subsystem-match=usb --action=change

if lsmod | grep -q '^usblp'; then
  sudo modprobe -r usblp || true
fi

for dev in /sys/bus/usb/drivers/usblp/*:*; do
  [[ -e "$dev" ]] || continue
  name="$(basename "$dev")"
  echo "$name" | sudo tee /sys/bus/usb/drivers/usblp/unbind >/dev/null 2>&1 || true
done

echo "usb setup done (user '$RUN_USER' added to plugdev — service restart required)"

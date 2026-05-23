#!/usr/bin/env bash
set -euo pipefail

for dev in /sys/bus/usb/drivers/usblp/*:*; do
  [[ -e "$dev" ]] || continue
  echo "$(basename "$dev")" | sudo tee /sys/bus/usb/drivers/usblp/unbind >/dev/null 2>&1 || true
done

for d in /sys/bus/usb/devices/*-*; do
  [[ -f "$d/idVendor" ]] || continue
  [[ "$(cat "$d/idVendor")" == "04f9" && "$(cat "$d/idProduct")" == "20af" ]] || continue
  echo 0 | sudo tee "$d/authorized" >/dev/null
  sleep 1
  echo 1 | sudo tee "$d/authorized" >/dev/null
  break
done

sleep 2
docker exec ptlabel chain-print --wake

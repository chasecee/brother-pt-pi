#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

LOCK="$ROOT/.rebuild.lock"
exec 9>"$LOCK"
if ! flock -n 9; then
  echo "rebuild already in progress"
  exit 0
fi

echo "pulling latest image..."
./scripts/pi-usb-setup.sh
docker compose pull
docker compose up -d
docker image prune -f >/dev/null
./scripts/pi-verify.sh || true

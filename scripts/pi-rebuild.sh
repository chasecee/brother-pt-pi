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

echo "rebuilding..."
docker compose build
docker compose up -d
./scripts/pi-verify.sh || true

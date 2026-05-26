#!/usr/bin/env bash
set -euo pipefail

REPO="${1:?usage: $0 git@github.com:you/brother-pt-pi.git}"
ROOT="${PTLABEL_ROOT:-$HOME/ptlabel}"
BRANCH="${PTLABEL_BRANCH:-main}"

if ! command -v docker >/dev/null; then
  echo "install Docker first: https://docs.docker.com/engine/install/debian/" >&2
  exit 1
fi

if ! docker compose version >/dev/null 2>&1; then
  echo "install Docker Compose plugin first" >&2
  exit 1
fi

if [[ ! -d "$ROOT/.git" ]]; then
  git clone --branch "$BRANCH" "$REPO" "$ROOT"
fi

cd "$ROOT"
git config pull.ff only
chmod +x scripts/pi-verify.sh scripts/pi-usb-setup.sh scripts/pi-sync.sh scripts/pi-install-sync.sh

./scripts/pi-usb-setup.sh

export PTLABEL_ROOT="$ROOT"
export PTLABEL_BRANCH="$BRANCH"
./scripts/pi-sync.sh
./scripts/pi-install-sync.sh
./scripts/pi-verify.sh || true

echo "bootstrap done: $ROOT"
echo "updates: ptlabel-sync.timer runs git pull + docker compose pull every 60s"

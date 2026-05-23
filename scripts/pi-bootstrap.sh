#!/usr/bin/env bash
set -euo pipefail

REPO="${1:?usage: $0 git@github.com:you/brother-pt-pi.git}"
ROOT="${PTLABEL_ROOT:-$HOME/ptlabel}"
BRANCH="${PTLABEL_BRANCH:-main}"
USER_NAME="$(id -un)"

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
chmod +x scripts/pi-rebuild.sh scripts/pi-watch.sh scripts/pi-verify.sh

SERVICE="/etc/systemd/system/ptlabel-watch.service"
sed "s|%PTLABEL_ROOT%|$ROOT|g" deploy/ptlabel-watch.service | sudo tee "$SERVICE" >/dev/null
sudo sed -i "s|^Type=oneshot|Type=oneshot\nUser=$USER_NAME|" "$SERVICE"
sudo cp deploy/ptlabel-watch.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now ptlabel-watch.timer

./scripts/pi-rebuild.sh

echo "bootstrap done: $ROOT"
echo "watch timer: systemctl status ptlabel-watch.timer"

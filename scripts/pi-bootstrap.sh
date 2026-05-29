#!/usr/bin/env bash
set -euo pipefail

REPO="${1:?usage: $0 git@github.com:you/brother-pt-pi.git}"
ROOT="${PTLABEL_ROOT:-$HOME/ptlabel}"
BRANCH="${PTLABEL_BRANCH:-main}"
RUN_USER="${PTLABEL_USER:-$USER}"

if [[ $EUID -ne 0 ]] && ! command -v sudo >/dev/null; then
  echo "install sudo or run as root for systemd setup" >&2
  exit 1
fi

as_root() {
  if [[ $EUID -eq 0 ]]; then "$@"; else sudo "$@"; fi
}

if [[ ! -d "$ROOT/.git" ]]; then
  git clone --branch "$BRANCH" "$REPO" "$ROOT"
fi

cd "$ROOT"
git config pull.ff only
chmod +x scripts/pi-verify.sh scripts/pi-usb-setup.sh scripts/pi-sync.sh scripts/pi-install-sync.sh

./scripts/pi-usb-setup.sh

export PTLABEL_ROOT="$ROOT"
export PTLABEL_BRANCH="$BRANCH"
./scripts/pi-sync.sh || true
./scripts/pi-install-sync.sh

if [[ ! -x "$ROOT/bin/ptlabel-server" ]]; then
  echo "copy arm64 binary to $ROOT/bin/ptlabel-server (from CI release or local cross-build)" >&2
fi

render_unit() {
  sed \
    -e "s|__PTLABEL_ROOT__|$ROOT|g" \
    -e "s|__PTLABEL_BRANCH__|$BRANCH|g" \
    -e "s|__PTLABEL_USER__|$RUN_USER|g" \
    "$1"
}

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
render_unit "$ROOT/deploy/ptlabel.service" >"$tmp/ptlabel.service"
render_unit "$ROOT/deploy/ptlabel-sync.service" >"$tmp/ptlabel-sync.service"
render_unit "$ROOT/deploy/ptlabel-sync.timer" >"$tmp/ptlabel-sync.timer"

as_root cp "$tmp/ptlabel.service" /etc/systemd/system/
as_root cp "$tmp/ptlabel-sync.service" /etc/systemd/system/
as_root cp "$tmp/ptlabel-sync.timer" /etc/systemd/system/

as_root systemctl daemon-reload
as_root systemctl enable --now ptlabel.service
as_root systemctl enable --now ptlabel-sync.timer
as_root systemctl start ptlabel-sync.service

./scripts/pi-verify.sh || true

echo "bootstrap done: $ROOT"
echo "binary: $ROOT/bin/ptlabel-server"
echo "updates: ptlabel-sync.timer runs git pull + restart every 60s"

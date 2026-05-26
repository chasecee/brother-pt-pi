#!/usr/bin/env bash
set -euo pipefail

ROOT="${PTLABEL_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"
BRANCH="${PTLABEL_BRANCH:-main}"
RUN_USER="${PTLABEL_USER:-$USER}"

if [[ $EUID -ne 0 ]] && ! command -v sudo >/dev/null; then
  echo "install sudo or run as root" >&2
  exit 1
fi

as_root() {
  if [[ $EUID -eq 0 ]]; then "$@"; else sudo "$@"; fi
}

render_unit() {
  sed \
    -e "s|__PTLABEL_ROOT__|$ROOT|g" \
    -e "s|__PTLABEL_BRANCH__|$BRANCH|g" \
    -e "s|__PTLABEL_USER__|$RUN_USER|g" \
    "$1"
}

systemctl --user disable --now ptlabel-sync.timer 2>/dev/null || true

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
render_unit "$ROOT/deploy/ptlabel-sync.service" >"$tmp/ptlabel-sync.service"
render_unit "$ROOT/deploy/ptlabel-sync.timer" >"$tmp/ptlabel-sync.timer"

as_root cp "$tmp/ptlabel-sync.service" /etc/systemd/system/
as_root cp "$tmp/ptlabel-sync.timer" /etc/systemd/system/

as_root systemctl daemon-reload
as_root systemctl enable --now ptlabel-sync.timer
as_root systemctl start ptlabel-sync.service

echo "sync timer enabled: ptlabel-sync.timer (every 60s)"
echo "logs: journalctl -u ptlabel-sync.service -f"
echo "status: systemctl status ptlabel-sync.timer ptlabel-sync.service"

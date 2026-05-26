#!/usr/bin/env bash
set -euo pipefail

ROOT="${PTLABEL_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"
BRANCH="${PTLABEL_BRANCH:-main}"
UNIT_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"

mkdir -p "$UNIT_DIR"

render_unit() {
  sed \
    -e "s|__PTLABEL_ROOT__|$ROOT|g" \
    -e "s|__PTLABEL_BRANCH__|$BRANCH|g" \
    "$1"
}

render_unit "$ROOT/deploy/ptlabel-sync.service" >"$UNIT_DIR/ptlabel-sync.service"
render_unit "$ROOT/deploy/ptlabel-sync.timer" >"$UNIT_DIR/ptlabel-sync.timer"

systemctl --user daemon-reload
systemctl --user enable --now ptlabel-sync.timer

if command -v loginctl >/dev/null; then
  loginctl enable-linger "$USER" >/dev/null 2>&1 || true
fi

echo "sync timer enabled: ptlabel-sync.timer (every 60s)"
echo "logs: journalctl --user -u ptlabel-sync.service -f"

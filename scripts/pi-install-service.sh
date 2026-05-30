#!/usr/bin/env bash
set -euo pipefail

ROOT="${PTLABEL_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"
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
    -e "s|__PTLABEL_USER__|$RUN_USER|g" \
    "$1"
}

as_root systemctl disable --now ptlabel-sync.timer 2>/dev/null || true
systemctl --user disable --now ptlabel-sync.timer 2>/dev/null || true

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
render_unit "$ROOT/deploy/ptlabel.service" >"$tmp/ptlabel.service"
as_root cp "$tmp/ptlabel.service" /etc/systemd/system/

as_root systemctl daemon-reload
as_root systemctl enable ptlabel.service

if [[ -x "$ROOT/bin/ptlabel-server" ]]; then
  as_root systemctl enable --now ptlabel.service
else
  echo "ptlabel.service enabled; start after first deploy"
fi

echo "systemd: ptlabel.service -> $ROOT"

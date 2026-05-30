#!/usr/bin/env bash
set -euo pipefail

BIN_SRC="${1:?usage: $0 /path/to/ptlabel-server-linux-arm64}"
ROOT="${PTLABEL_ROOT:-$HOME/ptlabel}"
SRC="${GITHUB_WORKSPACE:-$(cd "$(dirname "$0")/.." && pwd)}"

mkdir -p "$ROOT/bin" "$ROOT/data"

rsync -a \
  --exclude .git \
  --exclude target \
  --exclude data \
  --exclude node_modules \
  --exclude .venv-golden \
  "$SRC/" "$ROOT/"

if command -v systemctl >/dev/null; then
  sudo systemctl stop ptlabel.service 2>/dev/null || true
fi

cp "$BIN_SRC" "$ROOT/bin/ptlabel-server"
chmod +x "$ROOT/bin/ptlabel-server"
chmod +x "$ROOT/scripts/"*.sh 2>/dev/null || true

if command -v systemctl >/dev/null; then
  sudo systemctl start ptlabel.service 2>/dev/null || true
fi

echo "pi-deploy: $ROOT ($(git -C "$SRC" rev-parse --short HEAD 2>/dev/null || echo unknown))"

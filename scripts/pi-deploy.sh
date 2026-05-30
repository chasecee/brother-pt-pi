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

# Atomic replace: install to sibling temp then rename. rename(2) succeeds
# even when the destination is currently executing, so the live server
# keeps running on its old inode until we restart it below.
install -m 0755 "$BIN_SRC" "$ROOT/bin/.ptlabel-server.new"
mv -f "$ROOT/bin/.ptlabel-server.new" "$ROOT/bin/ptlabel-server"
chmod +x "$ROOT/scripts/"*.sh

sudo systemctl restart ptlabel.service

echo "pi-deploy: $ROOT ($(git -C "$SRC" rev-parse --short HEAD 2>/dev/null || echo unknown))"

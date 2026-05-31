#!/usr/bin/env bash
set -euo pipefail

BIN_SRC="${1:?usage: $0 /path/to/ptlabel-server-linux-arm64}"
SHA="${GITHUB_SHA:?GITHUB_SHA not set; run via CI}"
ROOT="${PTLABEL_ROOT:-$HOME/ptlabel}"

mkdir -p "$ROOT/bin" "$ROOT/data"

# Sync source via origin. ~/ptlabel/.git is the single source of truth;
# clean removes any untracked stragglers.
git -C "$ROOT" fetch --depth 1 origin "$SHA"
git -C "$ROOT" reset --hard "$SHA"
git -C "$ROOT" clean -fd

# Atomic replace: install to sibling temp then rename. rename(2) succeeds
# even when the destination is currently executing, so the live server
# keeps running on its old inode until we restart it below.
install -m 0755 "$BIN_SRC" "$ROOT/bin/.ptlabel-server.new"
mv -f "$ROOT/bin/.ptlabel-server.new" "$ROOT/bin/ptlabel-server"
chmod +x "$ROOT/scripts/"*.sh

sudo systemctl restart ptlabel.service

echo "pi-deploy: $ROOT ($(git -C "$ROOT" rev-parse --short HEAD))"

#!/usr/bin/env bash
set -euo pipefail

ROOT="${PTLABEL_ROOT:-$HOME/ptlabel}"
BRANCH="${PTLABEL_BRANCH:-rust}"
REPO_REMOTE="${PTLABEL_REMOTE:-origin}"
ASSET_BASE_URL="${PTLABEL_ASSET_BASE_URL:-https://github.com/chasecee/brother-pt-pi/releases/download/rust-latest}"
ASSET_NAME="${PTLABEL_ASSET_NAME:-ptlabel-server-linux-armv6hf}"

if [[ ! -d "$ROOT/.git" ]]; then
  echo "repo missing at $ROOT (expected git clone)" >&2
  exit 1
fi

git -C "$ROOT" fetch --depth 1 "$REPO_REMOTE" "$BRANCH"
git -C "$ROOT" checkout "$BRANCH"
git -C "$ROOT" reset --hard "$REPO_REMOTE/$BRANCH"

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

curl -fL "$ASSET_BASE_URL/$ASSET_NAME" -o "$tmp/$ASSET_NAME"
curl -fL "$ASSET_BASE_URL/$ASSET_NAME.sha256" -o "$tmp/$ASSET_NAME.sha256"
(cd "$tmp" && sha256sum -c "$ASSET_NAME.sha256")

mkdir -p "$ROOT/bin"
install -m 0755 "$tmp/$ASSET_NAME" "$ROOT/bin/ptlabel-server"

sudo systemctl restart ptlabel.service
sudo systemctl --no-pager --full status ptlabel.service | sed -n '1,12p'

echo "updated: $ROOT ($BRANCH)"

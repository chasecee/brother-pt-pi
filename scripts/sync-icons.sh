#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="/Applications/P-touch Editor.app/Contents/Frameworks/BRLBXWrapperMac.framework/Versions/A/Resources/lbxdata.bundle/en"
DEST="$ROOT/icons/source/en"

if [ ! -d "$SRC" ]; then
  echo "Brother lbxdata not found at $SRC" >&2
  exit 1
fi

mkdir -p "$DEST"
cp "$SRC"/*.xml "$DEST/"

cd "$ROOT"
python3 scripts/build-icon-catalog.py

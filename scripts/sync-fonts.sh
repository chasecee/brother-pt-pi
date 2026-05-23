#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="/Applications/P-touch Editor.app/Contents/Frameworks/BRLBXWrapperMac.framework/Versions/A/Resources/fonts.bundle"
DEST="$ROOT/fonts"

if [ ! -d "$SRC" ]; then
  echo "Brother font bundle not found at $SRC" >&2
  exit 1
fi

mkdir -p "$DEST"
find "$DEST" -maxdepth 1 -type f \( -iname '*.ttf' -o -iname '*.otf' \) -delete

shopt -s nullglob nocaseglob
for f in "$SRC"/*.{ttf,TTF,otf,OTF}; do
  [ -f "$f" ] || continue
  cp "$f" "$DEST/"
done
for f in "$SRC/Fonts"/*.{ttf,TTF,otf,OTF}; do
  [ -f "$f" ] || continue
  cp "$f" "$DEST/"
done

cd "$ROOT"
python3 scripts/build-font-catalog.py

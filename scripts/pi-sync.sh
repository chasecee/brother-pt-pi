#!/usr/bin/env bash
set -euo pipefail

ROOT="${PTLABEL_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"
BRANCH="${PTLABEL_BRANCH:-main}"
BIN="$ROOT/bin/ptlabel-server"

cd "$ROOT"
echo "ptlabel-sync: $(date -Is) branch=$BRANCH"
git fetch origin "$BRANCH"
git pull --ff-only origin "$BRANCH"

if [[ ! -x "$BIN" ]]; then
  echo "ptlabel-sync: missing $BIN (run pi-bootstrap or copy arm64 binary)" >&2
  exit 1
fi

if command -v systemctl >/dev/null; then
  sudo systemctl restart ptlabel.service 2>/dev/null || systemctl --user restart ptlabel.service 2>/dev/null || true
fi

echo "ptlabel-sync: done"

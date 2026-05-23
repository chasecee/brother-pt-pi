#!/usr/bin/env bash
set -euo pipefail

ROOT="${PTLABEL_ROOT:-$HOME/ptlabel}"
BRANCH="${PTLABEL_BRANCH:-main}"
cd "$ROOT"

git fetch origin "$BRANCH"

LOCAL="$(git rev-parse HEAD)"
REMOTE="$(git rev-parse "origin/$BRANCH")"

if [[ "$LOCAL" == "$REMOTE" ]]; then
  exit 0
fi

echo "watch: $LOCAL -> $REMOTE"
git pull --ff-only origin "$BRANCH"
./scripts/pi-rebuild.sh

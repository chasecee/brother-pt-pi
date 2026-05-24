#!/usr/bin/env bash
set -euo pipefail

ROOT="${PTLABEL_ROOT:-$HOME/ptlabel}"
BRANCH="${PTLABEL_BRANCH:-main}"
cd "$ROOT"

git fetch origin "$BRANCH"
LOCAL="$(git rev-parse HEAD)"
REMOTE="$(git rev-parse "origin/$BRANCH")"
git_changed=0
if [[ "$LOCAL" != "$REMOTE" ]]; then
  echo "watch: git $LOCAL -> $REMOTE"
  git pull --ff-only origin "$BRANCH"
  git_changed=1
fi

IMAGE="$(awk '/^[[:space:]]*image:/ {print $2; exit}' docker-compose.yml)"
before="$(docker image inspect --format '{{.Id}}' "$IMAGE" 2>/dev/null || true)"
docker compose pull --quiet
after="$(docker image inspect --format '{{.Id}}' "$IMAGE" 2>/dev/null || true)"

if [[ "$git_changed" -eq 0 && "$before" == "$after" ]]; then
  exit 0
fi

echo "watch: applying update (git_changed=$git_changed image_changed=$([[ $before != $after ]] && echo 1 || echo 0))"
./scripts/pi-rebuild.sh

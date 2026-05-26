#!/usr/bin/env bash
set -euo pipefail

ROOT="${PTLABEL_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"
BRANCH="${PTLABEL_BRANCH:-main}"

cd "$ROOT"
git fetch origin "$BRANCH"
git pull --ff-only origin "$BRANCH"
docker compose pull
docker compose up -d

#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

PY=".venv-golden/bin/python"
if [[ ! -x "$PY" ]]; then
  python3 -m venv .venv-golden
  .venv-golden/bin/pip install -q -r tests/requirements-golden.txt
fi

"$PY" scripts/render-golden.py

if command -v node >/dev/null && [[ -f node_modules/canvas/package.json ]]; then
  node scripts/render-golden.mjs
  python3 scripts/compare-golden.py
else
  echo "skip js golden (npm install canvas opentype.js)"
  exit 0
fi

exit 0

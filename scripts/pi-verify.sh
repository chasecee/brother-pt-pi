#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

fail=0

if ! docker compose ps --status running 2>/dev/null | grep -q ptlabel; then
  echo "verify: ptlabel container not running" >&2
  fail=1
else
  echo "verify: container running"
fi

if ! curl -sf http://127.0.0.1:5000/api/status >/dev/null; then
  echo "verify: /api/status unreachable" >&2
  fail=1
else
  echo "verify: /api/status ok"
fi

if docker exec ptlabel chain-print --help >/dev/null 2>&1; then
  echo "verify: chain-print ok"
else
  echo "verify: chain-print missing or failed" >&2
  fail=1
fi

if docker exec ptlabel lsusb 2>/dev/null | grep -qi '04f9:20af'; then
  echo "verify: printer connected"
else
  echo "verify: printer not seen on USB (plug in and wake printer)" >&2
fi

exit "$fail"

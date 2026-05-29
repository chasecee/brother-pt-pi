#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

fail=0

if command -v systemctl >/dev/null; then
  if systemctl is-active --quiet ptlabel.service 2>/dev/null; then
    echo "verify: ptlabel.service running"
  else
    echo "verify: ptlabel.service not running" >&2
    fail=1
  fi
else
  if pgrep -f ptlabel-server >/dev/null; then
    echo "verify: ptlabel-server running"
  else
    echo "verify: ptlabel-server not running" >&2
    fail=1
  fi
fi

if ! curl -sf http://127.0.0.1:5000/api/status >/dev/null; then
  echo "verify: /api/status unreachable" >&2
  fail=1
else
  echo "verify: /api/status ok"
fi

if curl -sf http://127.0.0.1:5000/api/config >/dev/null; then
  echo "verify: /api/config ok"
else
  echo "verify: /api/config unreachable" >&2
  fail=1
fi

if lsusb 2>/dev/null | grep -qi '04f9:20af'; then
  echo "verify: printer connected"
else
  echo "verify: printer not seen on USB (plug in and wake printer)" >&2
fi

exit "$fail"

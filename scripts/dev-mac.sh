#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

export PTLABEL_ROOT="$ROOT"
export PATH="$HOME/.cargo/bin:$PATH"

if [[ ! -x target/release/ptlabel-server ]]; then
  echo "building ptlabel-server..."
  cargo build --release -p ptlabel-server
fi

if ioreg -p IOUSB -l 2>/dev/null | grep -q "PT-P710BT"; then
  :
else
  echo "warning: PT-P710BT not seen on USB (plug in, wake printer, quit Brother apps)"
fi

"${ROOT}/scripts/gen-tls-cert.sh" "${ROOT}/data"

echo "https://127.0.0.1:5001"
exec target/release/ptlabel-server --port 5001 --dev

#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

export PATH="$HOME/.cargo/bin:$PATH"

if [[ ! -x chain-print/target/release/chain-print ]]; then
  echo "building chain-print..."
  cargo build --release --manifest-path chain-print/Cargo.toml
fi
export CHAIN_PRINT="$ROOT/chain-print/target/release/chain-print"

if ! ioreg -p IOUSB -l 2>/dev/null | grep -q "PT-P710BT"; then
  echo "warning: PT-P710BT not seen on USB (plug in, wake printer, quit Brother apps)"
fi

python3 -m venv .venv
source .venv/bin/activate
pip install -q -r requirements.txt

export LABEL_FONT_SIZE=74

echo "http://127.0.0.1:5001"
export FLASK_DEBUG=1
exec flask --app app run --host 0.0.0.0 --port 5001 --reload

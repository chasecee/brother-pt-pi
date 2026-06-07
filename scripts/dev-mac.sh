#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

export PTLABEL_ROOT="$ROOT"
export PATH="$HOME/.cargo/bin:$PATH"

echo "building ptlabel-server..."
cargo build --release -p ptlabel-server

if ioreg -p IOUSB -l 2>/dev/null | grep -q "PT-P710BT"; then
  :
else
  echo "warning: PT-P710BT not seen on USB (plug in, wake printer, quit Brother apps)"
fi

echo "http://127.0.0.1:5001 (rust api)"
echo "http://127.0.0.1:4321 (astro ui)"

target/release/ptlabel-server --port 5001 --dev &
RUST_PID=$!

cleanup() {
  kill "$RUST_PID" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

bun run dev

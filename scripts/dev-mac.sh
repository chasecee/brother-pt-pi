#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

export PTLABEL_ROOT="$ROOT"
export PATH="$HOME/.cargo/bin:$PATH"

echo "building ptlabel-app..."
cargo build --release -p ptlabel-app

if ioreg -p IOUSB -l 2>/dev/null | grep -q "PT-P710BT"; then
  :
else
  echo "warning: PT-P710BT not seen on USB (plug in, wake printer, quit Brother apps)"
fi

echo "http://127.0.0.1:5001 (rust api)"
echo "http://127.0.0.1:4321 (astro ui)"

if lsof -tiTCP:5001 -sTCP:LISTEN >/dev/null 2>&1; then
  echo "stopping existing listener on :5001..."
  kill $(lsof -tiTCP:5001 -sTCP:LISTEN) 2>/dev/null || true
  sleep 0.2
fi

target/release/ptlabel-app --port 5001 --dev --root "$ROOT" &
RUST_PID=$!

for _ in $(seq 1 50); do
  if curl -sf "http://127.0.0.1:5001/api/icons/categories" >/dev/null; then
    break
  fi
  if ! kill -0 "$RUST_PID" 2>/dev/null; then
    echo "ptlabel-app exited before the api was ready" >&2
    exit 1
  fi
  sleep 0.1
done

cleanup() {
  kill "$RUST_PID" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

bun run dev

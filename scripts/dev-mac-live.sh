#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

export PTLABEL_ROOT="$ROOT"
export PATH="$HOME/.cargo/bin:$PATH"

if ! cargo watch --version >/dev/null 2>&1; then
  echo "cargo-watch is required. install with: cargo install cargo-watch"
  exit 1
fi

"${ROOT}/scripts/gen-tls-cert.sh" "${ROOT}/data"

echo "https://127.0.0.1:5001 (rust api)"
echo "http://127.0.0.1:4321 (astro ui)"

cargo watch \
  -w server \
  -w src \
  -w public \
  -w icons \
  -w fonts \
  -w Cargo.toml \
  -w Cargo.lock \
  -x "run -p ptlabel-server -- --port 5001 --dev" &
RUST_PID=$!

cleanup() {
  kill "$RUST_PID" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

bun run dev

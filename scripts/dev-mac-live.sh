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

echo "https://127.0.0.1:5001"
exec cargo watch \
  -w server \
  -w static \
  -w icons \
  -w fonts \
  -w Cargo.toml \
  -w Cargo.lock \
  -x "run -p ptlabel-server -- --port 5001 --dev"

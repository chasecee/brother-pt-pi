#!/usr/bin/env bash
set -euo pipefail

# Cross-builds ptlabel-app for x86_64-unknown-linux-musl inside rust:latest,
# using zig/cargo-zigbuild for fast native-host cross compilation.
# Output: .cache/ptlabel-app/bin/ptlabel-app (static, glibc-free, runs in
# Alpine LXC).

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RUST_DOCKER_IMAGE="${RUST_DOCKER_IMAGE:-rust:latest}"
DOCKER_CARGO_VOLUME="${DOCKER_CARGO_VOLUME:-ptlabel-cargo-cache}"
OUT_DIR="${ROOT}/.cache/ptlabel-app"

docker volume create "$DOCKER_CARGO_VOLUME" >/dev/null
docker run --rm \
  -v "${DOCKER_CARGO_VOLUME}:/cargo-home" \
  "$RUST_DOCKER_IMAGE" \
  chown -R "$(id -u):$(id -g)" /cargo-home

mkdir -p "${OUT_DIR}/bin" "${OUT_DIR}/target"

echo "==> building ptlabel-app (Rust, x86_64-unknown-linux-musl)"
docker run --rm \
  -v "${ROOT}:/work" \
  -v "${OUT_DIR}:/rust-out" \
  -v "${DOCKER_CARGO_VOLUME}:/cargo-home" \
  -e HOME=/tmp \
  -e CARGO_HOME=/cargo-home \
  -e CARGO_TARGET_DIR=/rust-out/target \
  -e HOST_UID="$(id -u)" \
  -e HOST_GID="$(id -g)" \
  -w /work \
  "$RUST_DOCKER_IMAGE" \
  bash -c '
set -euo pipefail
export PATH="/cargo-home/bin:$PATH"
if ! command -v curl >/dev/null 2>&1 || ! command -v xz >/dev/null 2>&1; then
  apt-get update >/dev/null
  apt-get install -y --no-install-recommends ca-certificates curl xz-utils >/dev/null
fi
if ! command -v zig >/dev/null 2>&1; then
  arch="$(uname -m)"
  case "$arch" in
    aarch64|arm64) zig_arch="aarch64" ;;
    x86_64|amd64) zig_arch="x86_64" ;;
    *) echo "unsupported arch for zig: $arch" >&2; exit 1 ;;
  esac
  zig_version="0.14.0"
  zig_url="https://ziglang.org/download/${zig_version}/zig-linux-${zig_arch}-${zig_version}.tar.xz"
  rm -rf /tmp/zig /opt/zig
  mkdir -p /tmp/zig
  curl -fsSL "$zig_url" -o /tmp/zig/zig.tar.xz
  tar -xJf /tmp/zig/zig.tar.xz -C /tmp/zig
  mv /tmp/zig/zig-linux-"${zig_arch}"-"${zig_version}" /opt/zig
  ln -sf /opt/zig/zig /usr/local/bin/zig
fi
if ! command -v cargo-zigbuild >/dev/null 2>&1; then
  cargo install cargo-zigbuild --root /cargo-home >/dev/null
fi
rustup target add x86_64-unknown-linux-musl >/dev/null 2>&1
CARGO_BUILD_JOBS="$(nproc)" cargo zigbuild --release --target x86_64-unknown-linux-musl -p ptlabel-app
cp /rust-out/target/x86_64-unknown-linux-musl/release/ptlabel-app /rust-out/bin/ptlabel-app
chown -R "${HOST_UID}:${HOST_GID}" /rust-out /cargo-home
'

echo "==> rust binary: ${OUT_DIR}/bin/ptlabel-app"

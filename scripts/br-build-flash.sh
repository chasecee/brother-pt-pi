#!/usr/bin/env bash
set -euo pipefail

# Builds the ptlabel-server Rust binary (ARMv6 + VFPv2) using Buildroot's own
# cross toolchain, then builds and (optionally) flashes the Buildroot SD image.
#
# Rust build prerequisites that matter:
#   - Pi Zero W is ARM1176JZF-S = ARMv6 + VFPv2 (no NEON/VFPv3).
#   - rustup's precompiled stdlib for arm-unknown-linux-gnueabihf is tagged v7,
#     so we use nightly + -Z build-std to rebuild std with our flags.
#   - Ubuntu's gcc-arm-linux-gnueabihf ships v7-only multilib (crt/libgcc),
#     which the linker would promote the binary's ARM ELF attributes back to
#     v7. We use Buildroot's own arm-buildroot-linux-gnueabihf-gcc instead.

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BR2_EXTERNAL="${ROOT}/buildroot-external"
BUILDROOT_DIR="${BUILDROOT_DIR:-${ROOT}/.cache/buildroot}"
HOST_OUT_DIR="${OUT_DIR:-${ROOT}/.cache/buildroot-out/pi0}"
DEFCONFIG="${DEFCONFIG:-ptlabel_pi0_defconfig}"
DOCKER_IMAGE="${DOCKER_IMAGE:-ptlabel-buildroot:2025.02}"
DOCKER_OUT_VOLUME="${DOCKER_OUT_VOLUME:-ptlabel-buildroot-out-pi0}"
DOCKER_DL_VOLUME="${DOCKER_DL_VOLUME:-ptlabel-buildroot-dl}"
DOCKER_CARGO_VOLUME="${DOCKER_CARGO_VOLUME:-ptlabel-cargo-cache}"
RUST_DOCKER_IMAGE="${RUST_DOCKER_IMAGE:-rust:latest}"
CONTAINER_OUT="/br-out"
RUST_OUT_DIR="${ROOT}/.cache/ptlabel-server"
MAX_FLASH_BYTES=$((65 * 1000 * 1000 * 1000))
DISK=""
DO_BUILD=1
RUST_ONLY=0
DEVICE=""

load_device() {
  local device_name="$1"
  local device_file="${ROOT}/devices/${device_name}.env"
  if [[ ! -f "$device_file" ]]; then
    echo "device profile not found: $device_file" >&2
    exit 1
  fi
  set -a
  # shellcheck source=/dev/null
  . "$device_file"
  set +a
}

usage() {
  cat <<EOF
usage: $0 [--disk /dev/diskN] [--flash-only] [--rust-only]
       $0 [--buildroot-dir PATH] [--out-dir PATH] [--defconfig NAME] [--device NAME]

  --rust-only   build only the Rust binary into .cache/ptlabel-server/bin/
                (used by ./deploy.sh for the fast Pi dev loop)
  --flash-only  skip building, just flash the existing image
  --disk        required unless --rust-only is set
  --device      load profile from devices/<name>.env
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --disk) DISK="${2:-}"; shift 2 ;;
    --buildroot-dir) BUILDROOT_DIR="${2:-}"; shift 2 ;;
    --out-dir) HOST_OUT_DIR="${2:-}"; shift 2 ;;
    --defconfig) DEFCONFIG="${2:-}"; shift 2 ;;
    --device)
      DEVICE="${2:-}"
      if [[ -z "$DEVICE" ]]; then
        echo "--device requires a value" >&2
        exit 1
      fi
      shift 2
      ;;
    --device=*) DEVICE="${1#--device=}"; shift ;;
    --flash-only|--no-build) DO_BUILD=0; shift ;;
    --rust-only) RUST_ONLY=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "unknown arg: $1" >&2; usage; exit 1 ;;
  esac
done

if [[ -n "$DEVICE" ]]; then
  load_device "$DEVICE"
fi
PTLABEL_MDNS_NAME="${PTLABEL_MDNS_NAME:-label}"
PTLABEL_HOSTNAME="${PTLABEL_HOSTNAME:-ptlabel-pi0}"
PTLABEL_PORT="${PTLABEL_PORT:-80}"

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "this script supports macOS host only" >&2
  exit 1
fi

if [[ $RUST_ONLY -eq 0 ]]; then
  if [[ -z "$DISK" ]]; then
    echo "--disk is required (unless --rust-only)" >&2
    usage
    exit 1
  fi
  if [[ ! "$DISK" =~ ^/dev/disk[0-9]+$ ]]; then
    echo "disk must look like /dev/diskN" >&2
    exit 1
  fi
  if ! diskutil info "$DISK" >/dev/null 2>&1; then
    echo "disk not found: $DISK" >&2
    exit 1
  fi
  DISK_INFO="$(diskutil info "$DISK")"
  if [[ "$(printf '%s\n' "$DISK_INFO" | awk -F': *' '/Internal/ {print $2}')" == "Yes" ]]; then
    echo "refusing to flash internal disk: $DISK" >&2
    exit 1
  fi
  DISK_BYTES="$(printf '%s\n' "$DISK_INFO" | awk -F'[()]' '/Disk Size/ {print $2}' | awk '{print $1}')"
  if [[ -z "${DISK_BYTES}" ]] || [[ ! "${DISK_BYTES}" =~ ^[0-9]+$ ]]; then
    echo "unable to parse disk size for $DISK" >&2
    exit 1
  fi
  if (( DISK_BYTES > MAX_FLASH_BYTES )); then
    echo "refusing to flash disk larger than 65GB: $DISK (${DISK_BYTES} bytes)" >&2
    exit 1
  fi
fi

ensure_buildroot_image() {
  if ! docker image inspect "$DOCKER_IMAGE" >/dev/null 2>&1; then
    docker build -t "$DOCKER_IMAGE" - <<'EOF'
FROM ubuntu:24.04
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y \
  bash bc bison build-essential bzip2 cpio curl file flex g++ gawk gcc git \
  make patch perl python3 rsync sed tar unzip wget xz-utils \
  libncurses-dev locales \
  && rm -rf /var/lib/apt/lists/*
RUN locale-gen en_US.UTF-8
ENV LANG=en_US.UTF-8
EOF
  fi
}

ensure_buildroot_volumes() {
  docker volume create "$DOCKER_OUT_VOLUME" >/dev/null
  docker volume create "$DOCKER_DL_VOLUME" >/dev/null
  docker run --rm \
    -v "${DOCKER_OUT_VOLUME}:${CONTAINER_OUT}" \
    "$DOCKER_IMAGE" \
    bash -lc "mkdir -p ${CONTAINER_OUT} && chown -R $(id -u):$(id -g) ${CONTAINER_OUT}"
  docker run --rm \
    -v "${DOCKER_DL_VOLUME}:/br-dl" \
    "$DOCKER_IMAGE" \
    bash -lc "mkdir -p /br-dl && chown -R $(id -u):$(id -g) /br-dl"
}

ensure_buildroot_source() {
  if [[ ! -d "$BUILDROOT_DIR/.git" ]]; then
    mkdir -p "$(dirname "$BUILDROOT_DIR")"
    git clone --depth 1 --branch 2025.02.x https://github.com/buildroot/buildroot.git "$BUILDROOT_DIR"
  fi
}

# Builds the Buildroot cross toolchain (host/) and target sysroot if not yet
# present. Cheap (instant) when stamps already exist in the output volume.
build_buildroot_toolchain() {
  echo "==> building Buildroot toolchain (cached on subsequent runs)"
  docker run --rm \
    -u "$(id -u):$(id -g)" \
    -v "${ROOT}:/work" \
    -v "${DOCKER_OUT_VOLUME}:${CONTAINER_OUT}" \
    -v "${DOCKER_DL_VOLUME}:/work/.cache/buildroot/dl" \
    -e PTLABEL_MDNS_NAME="${PTLABEL_MDNS_NAME}" \
    -e PTLABEL_HOSTNAME="${PTLABEL_HOSTNAME}" \
    -e PTLABEL_PORT="${PTLABEL_PORT}" \
    -w /work \
    "$DOCKER_IMAGE" \
    bash -lc "
      set -euo pipefail
      make -C /work/.cache/buildroot O=${CONTAINER_OUT} BR2_EXTERNAL=/work/buildroot-external ${DEFCONFIG}
      make -C /work/.cache/buildroot O=${CONTAINER_OUT} BR2_EXTERNAL=/work/buildroot-external toolchain
    "
}

# Cross-compiles ptlabel-server for ARMv6+VFPv2 using Buildroot's toolchain
# (which has v6-tagged crt, libgcc, libc). Nightly Rust with -Z build-std
# rebuilds std so the precompiled v7-tagged stdlib doesn't poison ARM ELF
# attributes via linker tag promotion. Output verified before declaring done.
build_ptlabel_server_binary() {
  docker volume create "$DOCKER_CARGO_VOLUME" >/dev/null
  docker run --rm \
    -v "${DOCKER_CARGO_VOLUME}:/cargo-home" \
    "$RUST_DOCKER_IMAGE" \
    chown -R "$(id -u):$(id -g)" /cargo-home
  mkdir -p "${RUST_OUT_DIR}/bin" "${RUST_OUT_DIR}/target" "${RUST_OUT_DIR}/rustup"

  echo "==> building ptlabel-server (Rust, ARMv6+VFPv2) against Buildroot toolchain"
  docker run --rm \
    -u "$(id -u):$(id -g)" \
    -v "${ROOT}:/work" \
    -v "${DOCKER_OUT_VOLUME}:/br-out:ro" \
    -v "${RUST_OUT_DIR}:/rust-out" \
    -v "${DOCKER_CARGO_VOLUME}:/cargo-home" \
    -e HOME=/tmp \
    -e CARGO_HOME=/cargo-home \
    -e RUSTUP_HOME=/rust-out/rustup \
    -e CARGO_TARGET_DIR=/rust-out/target \
    -w /work \
    "$RUST_DOCKER_IMAGE" \
    bash -c '
set -euo pipefail
mkdir -p "$RUSTUP_HOME" "$CARGO_HOME"
rustup install nightly --profile minimal --no-self-update >/dev/null 2>&1
rustup component add rust-src --toolchain nightly >/dev/null 2>&1
rustup target add arm-unknown-linux-gnueabihf --toolchain nightly >/dev/null 2>&1

ARMV6_FLAGS="-march=armv6 -mfpu=vfp -mfloat-abi=hard"
BR_GCC=/br-out/host/bin/arm-buildroot-linux-gnueabihf-gcc
WRAP=/tmp/armv6-gcc
cat >"$WRAP" <<EOF
#!/bin/sh
exec ${BR_GCC} ${ARMV6_FLAGS} "\$@"
EOF
chmod +x "$WRAP"

export CARGO_TARGET_ARM_UNKNOWN_LINUX_GNUEABIHF_LINKER="$WRAP"
export CC_arm_unknown_linux_gnueabihf="$WRAP"
export AR_arm_unknown_linux_gnueabihf=/br-out/host/bin/arm-buildroot-linux-gnueabihf-ar
export CFLAGS_arm_unknown_linux_gnueabihf="$ARMV6_FLAGS"
export RUSTFLAGS="-C target-cpu=arm1176jzf-s -C link-arg=-march=armv6 -C link-arg=-mfpu=vfp -C link-arg=-mfloat-abi=hard"

cargo +nightly build --release \
  --target arm-unknown-linux-gnueabihf \
  -Z build-std=std,panic_abort \
  -p ptlabel-server

cp /rust-out/target/arm-unknown-linux-gnueabihf/release/ptlabel-server /rust-out/bin/ptlabel-server

ATTRS=$(/br-out/host/bin/arm-buildroot-linux-gnueabihf-readelf -A /rust-out/bin/ptlabel-server)
echo "$ATTRS" | grep -E "CPU_arch|FP_arch"
echo "$ATTRS" | grep -q "Tag_CPU_arch: v6" || { echo "FATAL: binary is not ARMv6"; exit 1; }
echo "$ATTRS" | grep -q "Tag_FP_arch: VFPv2" || { echo "FATAL: FPU beyond VFPv2"; exit 1; }
'
}

# Full Buildroot build. Force ptlabel-server-dirclean so the freshly built
# local binary always gets re-copied + installed.
build_buildroot_image() {
  echo "==> building Buildroot image"
  docker run --rm \
    -u "$(id -u):$(id -g)" \
    -v "${ROOT}:/work" \
    -v "${DOCKER_OUT_VOLUME}:${CONTAINER_OUT}" \
    -v "${DOCKER_DL_VOLUME}:/work/.cache/buildroot/dl" \
    -e PTLABEL_MDNS_NAME="${PTLABEL_MDNS_NAME}" \
    -e PTLABEL_HOSTNAME="${PTLABEL_HOSTNAME}" \
    -e PTLABEL_PORT="${PTLABEL_PORT}" \
    -w /work \
    "$DOCKER_IMAGE" \
    bash -lc "
      set -euo pipefail
      make -C /work/.cache/buildroot O=${CONTAINER_OUT} BR2_EXTERNAL=/work/buildroot-external ${DEFCONFIG}
      make -C /work/.cache/buildroot O=${CONTAINER_OUT} BR2_EXTERNAL=/work/buildroot-external ptlabel-server-dirclean
      make -C /work/.cache/buildroot O=${CONTAINER_OUT} BR2_EXTERNAL=/work/buildroot-external -j\"$(sysctl -n hw.ncpu)\"
    "
}

sync_out_from_volume() {
  mkdir -p "${HOST_OUT_DIR}/images"
  docker run --rm \
    -v "${DOCKER_OUT_VOLUME}:${CONTAINER_OUT}:ro" \
    -v "${HOST_OUT_DIR}:/host-out" \
    "$DOCKER_IMAGE" \
    bash -lc "
      set -euo pipefail
      test -f ${CONTAINER_OUT}/images/sdcard.img
      cp -a ${CONTAINER_OUT}/images/sdcard.img /host-out/images/
      if [[ -d ${CONTAINER_OUT}/target/opt/ptlabel ]]; then
        mkdir -p /host-out/target/opt
        rsync -a --delete ${CONTAINER_OUT}/target/opt/ptlabel/ /host-out/target/opt/ptlabel/
      fi
    "
}

# --- main flow ---

if [[ $RUST_ONLY -eq 1 ]]; then
  ensure_buildroot_image
  ensure_buildroot_volumes
  ensure_buildroot_source
  build_buildroot_toolchain
  build_ptlabel_server_binary
  echo "==> rust binary: ${RUST_OUT_DIR}/bin/ptlabel-server"
  exit 0
fi

ensure_buildroot_source

if [[ $DO_BUILD -eq 1 ]]; then
  ensure_buildroot_image
  ensure_buildroot_volumes
  build_buildroot_toolchain
  build_ptlabel_server_binary
  build_buildroot_image
fi

sync_out_from_volume

IMG="${HOST_OUT_DIR}/images/sdcard.img"
if [[ ! -f "$IMG" ]]; then
  echo "image missing: $IMG" >&2
  exit 1
fi

echo "about to flash ${IMG} to ${DISK}"
DISK_SIZE="$(diskutil info "$DISK" | awk -F': *' '/Disk Size/ {split($2, a, " \\("); print a[1]; exit}')"
echo "type /dev/diskX to confirm"
if [[ -n "${DISK_SIZE}" ]]; then
  echo "target size: ${DISK_SIZE}"
fi
echo "type ${DISK} to continue:"
read -r confirm
if [[ "$confirm" != "$DISK" ]]; then
  echo "confirmation mismatch" >&2
  exit 1
fi

sudo diskutil unmountDisk force "$DISK"
sudo dd if="$IMG" of="/dev/r${DISK#/dev/}" bs=4m conv=sync
sync
diskutil eject "$DISK"

echo "flash complete: $DISK"

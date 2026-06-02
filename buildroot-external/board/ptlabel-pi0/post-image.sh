#!/usr/bin/env bash
set -euo pipefail

BINARIES_DIR="${BINARIES_DIR:?missing BINARIES_DIR}"
BUILD_DIR="${BUILD_DIR:?missing BUILD_DIR}"
GENIMAGE_CFG="${BR2_EXTERNAL_PTLABEL_PATH:?missing BR2_EXTERNAL_PTLABEL_PATH}/board/ptlabel-pi0/genimage.cfg"

rm -rf "${BINARIES_DIR}/genimage.tmp"

BOARD_DIR="${BR2_EXTERNAL_PTLABEL_PATH}/board/ptlabel-pi0"

cp -f "${BINARIES_DIR}/rpi-firmware/bootcode.bin" "${BINARIES_DIR}/bootcode.bin"
cp -f "${BINARIES_DIR}/rpi-firmware/start.elf" "${BINARIES_DIR}/start.elf"
cp -f "${BINARIES_DIR}/rpi-firmware/fixup.dat" "${BINARIES_DIR}/fixup.dat"
install -m 0644 "${BOARD_DIR}/config.txt" "${BINARIES_DIR}/config.txt"
install -m 0644 "${BOARD_DIR}/cmdline.txt" "${BINARIES_DIR}/cmdline.txt"

rm -rf "${BINARIES_DIR}/overlays"
cp -a "${BINARIES_DIR}/rpi-firmware/overlays" "${BINARIES_DIR}/overlays"

shopt -s nullglob
DTS_DIR=""
for d in "${BUILD_DIR}"/linux-*/arch/arm/boot/dts/broadcom; do
  case "$(basename "$(dirname "$(dirname "$(dirname "$(dirname "$(dirname "${d}")")")")")")" in
    linux-headers-*) continue ;;
  esac
  if [ -f "${d}/bcm2708-rpi-zero-w.dtb" ]; then
    DTS_DIR="${d}"
    break
  fi
done
shopt -u nullglob

if [ -z "${DTS_DIR}" ]; then
  echo "kernel-built Pi Zero W DTB not found under ${BUILD_DIR}/linux-*/arch/arm/boot/dts/broadcom" >&2
  exit 1
fi

for dtb in bcm2708-rpi-zero.dtb bcm2708-rpi-zero-w.dtb; do
  if [ ! -f "${DTS_DIR}/${dtb}" ]; then
    echo "missing kernel-built DTB: ${DTS_DIR}/${dtb}" >&2
    exit 1
  fi
  cp -f "${DTS_DIR}/${dtb}" "${BINARIES_DIR}/${dtb}"
done

genimage \
  --rootpath "${TARGET_DIR}" \
  --tmppath "${BINARIES_DIR}/genimage.tmp" \
  --inputpath "${BINARIES_DIR}" \
  --outputpath "${BINARIES_DIR}" \
  --config "${GENIMAGE_CFG}"

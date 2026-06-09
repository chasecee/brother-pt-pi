#!/usr/bin/env bash
set -euo pipefail

TARGET_DIR="${1:?missing TARGET_DIR}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
EXTERNAL_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
SOURCE_ROOT="$(cd "${EXTERNAL_DIR}/.." && pwd)"
WPA_CONF_SRC="${EXTERNAL_DIR}/board/ptlabel-pi0/wpa_supplicant.conf"
WPA_CONF_DST="${TARGET_DIR}/etc/wpa_supplicant.conf"
INTERFACES_FILE="${TARGET_DIR}/etc/network/interfaces"
DROPBEAR_DIR="${TARGET_DIR}/etc/dropbear"
DROPBEARKEY="${HOST_DIR:?missing HOST_DIR}/bin/dropbearkey"
PTLABEL_HOSTNAME="${PTLABEL_HOSTNAME:-ptlabel-pi0}"
PTLABEL_MDNS_NAME="${PTLABEL_MDNS_NAME:-label}"
PTLABEL_PORT="${PTLABEL_PORT:-80}"
PTLABEL_DIAGNOSTICS="${PTLABEL_DIAGNOSTICS:-0}"
PTLABEL_STATIC_IPV4="${PTLABEL_STATIC_IPV4:-}"
PTLABEL_STATIC_GW="${PTLABEL_STATIC_GW:-}"
PTLABEL_STATIC_DNS="${PTLABEL_STATIC_DNS:-}"
PTLABEL_DEFAULTS="${TARGET_DIR}/etc/default/ptlabel"
IMAGE_INFO="${TARGET_DIR}/etc/ptlabel-image-info"
BUILD_UTC="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
GIT_SHA="$(git -C "${SOURCE_ROOT}" rev-parse --short HEAD 2>/dev/null || echo unknown)"

# Skeleton symlinks /var/log into tmpfs; keep logs on the SD card so boot
# failures survive a power pull.
if [ -L "${TARGET_DIR}/var/log" ]; then
  rm "${TARGET_DIR}/var/log"
fi

mkdir -p \
  "${TARGET_DIR}/opt/ptlabel/bin" \
  "${TARGET_DIR}/opt/ptlabel/data" \
  "${TARGET_DIR}/var/log/ptlabel"

chmod 0755 \
  "${TARGET_DIR}/etc/init.d/S20ptlabel" \
  "${TARGET_DIR}/etc/init.d/S60ptlabel-diagnostics" \
  "${TARGET_DIR}/usr/bin/ptlabel-diagnostics"

if [ ! -s "${WPA_CONF_SRC}" ]; then
  echo "missing Wi-Fi config: ${WPA_CONF_SRC}" >&2
  echo "create it from board/ptlabel-pi0/wpa_supplicant.conf.example" >&2
  exit 1
fi

install -D -m 0600 "${WPA_CONF_SRC}" "${WPA_CONF_DST}"

AUTH_KEYS_SRC="${EXTERNAL_DIR}/board/ptlabel-pi0/authorized_keys"
if [ ! -s "${AUTH_KEYS_SRC}" ]; then
  echo "missing SSH key: ${AUTH_KEYS_SRC}" >&2
  echo "copy your pubkey there so deploy.sh/pi-boot-report.sh can reach the device" >&2
  exit 1
fi
install -D -m 0600 "${AUTH_KEYS_SRC}" "${TARGET_DIR}/root/.ssh/authorized_keys"
chmod 700 "${TARGET_DIR}/root/.ssh"

cat >"${INTERFACES_FILE}" <<'EOF'
auto lo
iface lo inet loopback
EOF

printf '%s\n' "${PTLABEL_HOSTNAME}" >"${TARGET_DIR}/etc/hostname"
sed -i -e '/^127\.0\.1\.1[[:space:]]/d' "${TARGET_DIR}/etc/hosts"
printf '127.0.1.1\t%s\n' "${PTLABEL_HOSTNAME}" >>"${TARGET_DIR}/etc/hosts"

cat >"${PTLABEL_DEFAULTS}" <<EOF
PTLABEL_ROOT=/opt/ptlabel
PTLABEL_DATA_DIR=/opt/ptlabel/data
PTLABEL_PORT=${PTLABEL_PORT}
PTLABEL_MDNS_NAME=${PTLABEL_MDNS_NAME}
PTLABEL_DIAGNOSTICS=${PTLABEL_DIAGNOSTICS}
PTLABEL_STATIC_IPV4=${PTLABEL_STATIC_IPV4}
PTLABEL_STATIC_GW=${PTLABEL_STATIC_GW}
PTLABEL_STATIC_DNS=${PTLABEL_STATIC_DNS}
EOF

cat >"${IMAGE_INFO}" <<EOF
PTLABEL_HOSTNAME=${PTLABEL_HOSTNAME}
PTLABEL_MDNS_NAME=${PTLABEL_MDNS_NAME}
PTLABEL_PORT=${PTLABEL_PORT}
BUILD_UTC=${BUILD_UTC}
GIT_SHA=${GIT_SHA}
EOF

chmod 0755 "${TARGET_DIR}/etc/init.d/S05wifi"

# linux-firmware ships the board NVRAM (.txt) but not a board-named .bin;
# the symlink kills one failed firmware lookup (~0.3s) at wifi probe.
ln -sf brcmfmac43430-sdio.bin \
  "${TARGET_DIR}/lib/firmware/brcm/brcmfmac43430-sdio.raspberrypi,model-zero-w.bin"
test -s "${TARGET_DIR}/lib/firmware/brcm/brcmfmac43430-sdio.raspberrypi,model-zero-w.txt" || {
  echo "missing board NVRAM for brcmfmac43430" >&2
  exit 1
}

if [ -L "${DROPBEAR_DIR}" ] && [ "$(readlink "${DROPBEAR_DIR}")" = "/var/run/dropbear" ]; then
  rm -f "${DROPBEAR_DIR}"
fi
mkdir -p "${DROPBEAR_DIR}"
if [ -x "${DROPBEARKEY}" ]; then
  [ -s "${DROPBEAR_DIR}/dropbear_rsa_host_key" ] || \
    "${DROPBEARKEY}" -t rsa -s 2048 -f "${DROPBEAR_DIR}/dropbear_rsa_host_key"
  [ -s "${DROPBEAR_DIR}/dropbear_ed25519_host_key" ] || \
    "${DROPBEARKEY}" -t ed25519 -f "${DROPBEAR_DIR}/dropbear_ed25519_host_key"
else
  echo "warning: dropbearkey not found at ${DROPBEARKEY}; host keys will be generated on first boot" >&2
fi

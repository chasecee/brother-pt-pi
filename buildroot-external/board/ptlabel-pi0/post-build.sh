#!/usr/bin/env bash
set -euo pipefail

TARGET_DIR="${1:?missing TARGET_DIR}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
EXTERNAL_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
WPA_CONF_SRC="${EXTERNAL_DIR}/board/ptlabel-pi0/wpa_supplicant.conf"
WPA_CONF_DST="${TARGET_DIR}/etc/wpa_supplicant.conf"
INTERFACES_FILE="${TARGET_DIR}/etc/network/interfaces"

mkdir -p \
  "${TARGET_DIR}/opt/ptlabel/bin" \
  "${TARGET_DIR}/opt/ptlabel/data" \
  "${TARGET_DIR}/var/log/ptlabel"

chmod 0755 \
  "${TARGET_DIR}/etc/init.d/S50ptlabel" \
  "${TARGET_DIR}/etc/init.d/S60ptlabel-diagnostics" \
  "${TARGET_DIR}/usr/bin/ptlabel-diagnostics"

if [ ! -s "${WPA_CONF_SRC}" ]; then
  echo "missing Wi-Fi config: ${WPA_CONF_SRC}" >&2
  echo "create it from board/ptlabel-pi0/wpa_supplicant.conf.example" >&2
  exit 1
fi

install -D -m 0600 "${WPA_CONF_SRC}" "${WPA_CONF_DST}"

cat >"${INTERFACES_FILE}" <<'EOF'
auto lo
iface lo inet loopback
EOF

chmod 0755 "${TARGET_DIR}/etc/init.d/S35wifi"

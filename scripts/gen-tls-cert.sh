#!/usr/bin/env bash
# Self-signed ECDSA P-256 cert. Runs on the host (needs openssl).
#
# usage: gen-tls-cert.sh <out_dir> [extra_ip ...]
# env:
#   PTLABEL_MDNS_NAME (default: "label")    — extra SAN <name> + <name>.local
#   PTLABEL_HOSTNAME  (default: "ptlabel-pi0") — extra SAN <host> + <host>.local
#
# Idempotent: skips regeneration when an existing cert already covers every
# DNS SAN we want.

set -euo pipefail

OUT_DIR="${1:?out_dir required}"
shift || true
EXTRA_IPS=("$@")

CRT="${OUT_DIR}/leaf.pem"
KEY="${OUT_DIR}/leaf.key.pem"

MDNS_NAME="${PTLABEL_MDNS_NAME:-label}"
MDNS_NAME="${MDNS_NAME%.local}"
HOST_NAME="${PTLABEL_HOSTNAME:-ptlabel-pi0}"
HOST_NAME="${HOST_NAME%.local}"

want_dns=(localhost "${HOST_NAME}" "${HOST_NAME}.local" "${MDNS_NAME}" "${MDNS_NAME}.local")

if [ -f "$CRT" ] && [ -f "$KEY" ]; then
  existing="$(openssl x509 -in "$CRT" -noout -ext subjectAltName 2>/dev/null || true)"
  ok=1
  for d in "${want_dns[@]}"; do
    grep -q "DNS:${d}\b" <<<"$existing" || { ok=0; break; }
  done
  [ "$ok" = "1" ] && exit 0
fi

mkdir -p "$OUT_DIR"

san="DNS:localhost,DNS:${HOST_NAME},DNS:${HOST_NAME}.local,DNS:${MDNS_NAME},DNS:${MDNS_NAME}.local,IP:127.0.0.1"
for ip in "${EXTRA_IPS[@]}"; do
  [ -n "$ip" ] && san="${san},IP:${ip}"
done

tmpkey="$(mktemp)"
tmpcrt="$(mktemp)"
trap 'rm -f "$tmpkey" "$tmpcrt"' EXIT
openssl ecparam -name prime256v1 -genkey -noout -out "$tmpkey"
openssl req -x509 -new -key "$tmpkey" -out "$tmpcrt" -days 3650 -nodes \
  -subj "/CN=${MDNS_NAME}" \
  -addext "subjectAltName=${san}" \
  -addext "extendedKeyUsage=serverAuth" \
  -addext "keyUsage=digitalSignature,keyEncipherment"
mv "$tmpcrt" "$CRT"
mv "$tmpkey" "$KEY"
chmod 600 "$KEY"
trap - EXIT

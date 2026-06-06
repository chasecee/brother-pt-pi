#!/usr/bin/env sh
# Generate a self-signed ECDSA P-256 cert valid for localhost + every non-loopback
# IPv4 on the box. Idempotent: if leaf.pem + leaf.key.pem already exist, returns 0.
#
# usage: gen-tls-cert.sh <data_dir>
# writes <data_dir>/tls/leaf.pem and <data_dir>/tls/leaf.key.pem

set -eu

DATA_DIR="${1:?data_dir required}"
TLS_DIR="${DATA_DIR}/tls"
CRT="${TLS_DIR}/leaf.pem"
KEY="${TLS_DIR}/leaf.key.pem"

[ -f "$CRT" ] && [ -f "$KEY" ] && exit 0

mkdir -p "$TLS_DIR"

HOSTN="$(hostname 2>/dev/null || echo ptlabel)"
HOSTN_BASE="${HOSTN%.local}"
SAN="DNS:localhost,DNS:${HOSTN_BASE},DNS:${HOSTN_BASE}.local,IP:127.0.0.1"

if command -v ip >/dev/null 2>&1; then
  IFACE_IPS="$(ip -4 -o addr show scope global 2>/dev/null | awk '{split($4,a,"/"); print a[1]}')"
else
  IFACE_IPS="$(ifconfig 2>/dev/null | awk '/inet /{print $2}' | grep -v '^127\.')"
fi
for ip in $IFACE_IPS; do
  SAN="${SAN},IP:${ip}"
done

TMPKEY="$(mktemp)"
openssl ecparam -name prime256v1 -genkey -noout -out "$TMPKEY"
openssl req -x509 -new -key "$TMPKEY" -out "$CRT" -days 3650 -nodes \
  -subj "/CN=ptlabel" \
  -addext "subjectAltName=${SAN}" \
  -addext "extendedKeyUsage=serverAuth" \
  -addext "keyUsage=digitalSignature,keyEncipherment"
mv "$TMPKEY" "$KEY"
chmod 600 "$KEY"

#!/usr/bin/env bash
set -euo pipefail

HOST="${1:?usage: $0 pi@host}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TAR="$ROOT/ptlabel-arm64.tar.gz"

cd "$ROOT"
make save
ssh "$HOST" "mkdir -p ~/ptlabel/scripts ~/ptlabel/deploy"
scp "$TAR" docker-compose.yml "$HOST:~/ptlabel/"
scp scripts/pi-verify.sh scripts/pi-usb-setup.sh "$HOST:~/ptlabel/scripts/"
scp deploy/99-brother-pt710bt-usblp.rules "$HOST:~/ptlabel/deploy/"
ssh "$HOST" 'chmod +x ~/ptlabel/scripts/pi-verify.sh ~/ptlabel/scripts/pi-usb-setup.sh'
ssh "$HOST" 'cd ~/ptlabel && ./scripts/pi-usb-setup.sh && gunzip -c ptlabel-arm64.tar.gz | docker load && docker compose up -d'
ssh "$HOST" '~/ptlabel/scripts/pi-verify.sh' || true
echo "Open http://$(ssh "$HOST" hostname -I | awk "{print \$1}"):5000"
echo "For daily dev, run scripts/pi-bootstrap.sh on the Pi instead of tarball deploy."

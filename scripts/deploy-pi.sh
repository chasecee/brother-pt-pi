#!/usr/bin/env bash
set -euo pipefail

HOST="${1:?usage: $0 pi@host}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TAR="$ROOT/ptlabel-arm64.tar.gz"

cd "$ROOT"
make save
scp "$TAR" docker-compose.yml "$HOST:~/ptlabel/"
ssh "$HOST" 'cd ~/ptlabel && gunzip -c ptlabel-arm64.tar.gz | docker load && docker compose up -d'
ssh "$HOST" "mkdir -p ~/ptlabel/scripts"
scp scripts/pi-verify.sh "$HOST:~/ptlabel/scripts/"
ssh "$HOST" 'chmod +x ~/ptlabel/scripts/pi-verify.sh && ~/ptlabel/scripts/pi-verify.sh' || true
echo "Open http://$(ssh "$HOST" hostname -I | awk "{print \$1}"):5000"
echo "For daily dev, run scripts/pi-bootstrap.sh on the Pi instead of tarball deploy."

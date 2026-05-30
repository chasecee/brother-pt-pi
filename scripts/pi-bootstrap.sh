#!/usr/bin/env bash
set -euo pipefail

REPO="${1:?usage: $0 git@github.com:you/brother-pt-pi.git}"
ROOT="${PTLABEL_ROOT:-$HOME/ptlabel}"
BRANCH="${PTLABEL_BRANCH:-main}"
RUN_USER="${PTLABEL_USER:-$USER}"

if [[ $EUID -ne 0 ]] && ! command -v sudo >/dev/null; then
  echo "install sudo or run as root for systemd setup" >&2
  exit 1
fi

as_root() {
  if [[ $EUID -eq 0 ]]; then "$@"; else sudo "$@"; fi
}

as_root apt-get update -qq
as_root apt-get install -y git usbutils uhubctl curl

if [[ ! -d "$ROOT/.git" ]]; then
  git clone --branch "$BRANCH" "$REPO" "$ROOT"
fi

cd "$ROOT"
git config pull.ff only
chmod +x scripts/pi-verify.sh scripts/pi-usb-setup.sh scripts/pi-sync.sh scripts/pi-install-sync.sh

./scripts/pi-usb-setup.sh

if [[ -n "${PTLABEL_GITHUB_TOKEN:-${GITHUB_TOKEN:-}}" ]]; then
  as_root mkdir -p /etc/ptlabel
  if [[ ! -f /etc/ptlabel/env ]]; then
    printf 'PTLABEL_GITHUB_TOKEN=%s\n' "${PTLABEL_GITHUB_TOKEN:-$GITHUB_TOKEN}" | as_root tee /etc/ptlabel/env >/dev/null
    as_root chmod 600 /etc/ptlabel/env
    echo "wrote /etc/ptlabel/env (private repo token)"
  fi
elif [[ ! -f /etc/ptlabel/env ]]; then
  echo "private repo: set PTLABEL_GITHUB_TOKEN before bootstrap or add /etc/ptlabel/env" >&2
fi

export PTLABEL_ROOT="$ROOT"
export PTLABEL_BRANCH="$BRANCH"
./scripts/pi-install-sync.sh
./scripts/pi-sync.sh || true

./scripts/pi-verify.sh || true

echo "bootstrap done: $ROOT"
echo "updates: ptlabel-sync.timer runs git pull + release binary every 60s"

#!/usr/bin/env bash
set -euo pipefail

REPO="${1:?usage: RUNNER_TOKEN=xxx $0 https://github.com/you/brother-pt-pi.git}"
ROOT="${PTLABEL_ROOT:-$HOME/ptlabel}"
BRANCH="${PTLABEL_BRANCH:-rust}"
RUN_USER="${PTLABEL_USER:-$USER}"

if [[ $EUID -ne 0 ]] && ! command -v sudo >/dev/null; then
  echo "install sudo or run as root for systemd setup" >&2
  exit 1
fi

as_root() {
  if [[ $EUID -eq 0 ]]; then "$@"; else sudo "$@"; fi
}

repo_url() {
  local url="$1"
  if [[ "$url" =~ ^git@github.com:(.+)$ ]]; then
    echo "https://github.com/${BASH_REMATCH[1]%.git}"
    return
  fi
  echo "${url%.git}"
}

REPO_URL="$(repo_url "$REPO")"

as_root apt-get update -qq
as_root apt-get install -y git usbutils uhubctl curl rsync

if [[ ! -d "$ROOT/.git" ]]; then
  git clone --branch "$BRANCH" --depth 1 "$REPO" "$ROOT"
fi

cd "$ROOT"
chmod +x scripts/pi-verify.sh scripts/pi-usb-setup.sh scripts/pi-deploy.sh scripts/pi-install-service.sh scripts/pi-runner-install.sh

./scripts/pi-usb-setup.sh

export PTLABEL_ROOT="$ROOT"
./scripts/pi-install-service.sh

if [[ -z "${RUNNER_TOKEN:-}" ]]; then
  echo "RUNNER_TOKEN not set — register runner:" >&2
  echo "  RUNNER_TOKEN=xxx ./scripts/pi-runner-install.sh $REPO_URL" >&2
else
  ./scripts/pi-runner-install.sh "$REPO_URL"
fi

./scripts/pi-verify.sh || true

echo "bootstrap done: $ROOT"
echo "deploy: git push -> CI builds on GitHub -> deploy-pi job on this runner"

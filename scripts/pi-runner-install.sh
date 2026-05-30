#!/usr/bin/env bash
set -euo pipefail

REPO_URL="${1:?usage: RUNNER_TOKEN=xxx $0 https://github.com/you/brother-pt-pi}"
RUNNER_DIR="${PTLABEL_RUNNER_DIR:-$HOME/actions-runner}"
RUNNER_VERSION="${RUNNER_VERSION:-2.334.0}"
TOKEN="${RUNNER_TOKEN:?get a token from GitHub: Settings > Actions > Runners > New self-hosted runner}"

if [[ $EUID -eq 0 ]]; then
  echo "run as your normal user (pi), not root" >&2
  exit 1
fi

mkdir -p "$RUNNER_DIR"
cd "$RUNNER_DIR"

if [[ ! -f ./config.sh ]]; then
  curl -sSf -o actions-runner.tar.gz -L \
    "https://github.com/actions/runner/releases/download/v${RUNNER_VERSION}/actions-runner-linux-arm64-${RUNNER_VERSION}.tar.gz"
  tar xzf actions-runner.tar.gz
  rm actions-runner.tar.gz
fi

./config.sh \
  --url "$REPO_URL" \
  --token "$TOKEN" \
  --name "$(hostname)-pi" \
  --labels pi \
  --unattended \
  --replace

sudo ./svc.sh install "$USER"
sudo ./svc.sh start

echo "runner installed: $RUNNER_DIR (label: pi)"
echo "check: journalctl -u actions.runner.* -f"

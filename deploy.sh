#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
STATIC_ONLY=0
ALL=0
HOST=""
DEVICE=""
DEFAULTS_FILE=""
CONFD_FILE=""
APP_BUILD_STAMP="${ROOT}/.cache/ptlabel-app/.last-build-success"
APP_DEPLOY_STAMP="${ROOT}/.cache/ptlabel-app/.last-deployed"
BRIDGE_BUILD_STAMP="${ROOT}/.cache/ptlabel-bridge/.last-build-success"
BRIDGE_DEPLOY_STAMP="${ROOT}/.cache/ptlabel-bridge/.last-deployed"
APP_BUILT=0

tree_changed_since() {
  local stamp="$1"
  shift
  [[ ! -f "$stamp" ]] && return 0
  for rel in "$@"; do
    local path="${ROOT}/${rel}"
    if [[ -f "$path" && "$path" -nt "$stamp" ]]; then
      return 0
    fi
    if [[ -d "$path" ]] && find "$path" -newer "$stamp" -print -quit 2>/dev/null | grep -q .; then
      return 0
    fi
  done
  return 1
}

run_deploy_all() {
  local extra=()
  local did=0
  [[ $STATIC_ONLY -eq 1 ]] && extra+=(--static-only)
  if [[ ! -f "${ROOT}/devices/lxc.env" || ! -f "${ROOT}/devices/bridge.env" ]]; then
    echo "devices/lxc.env and devices/bridge.env required for multi-target deploy" >&2
    exit 1
  fi
  if tree_changed_since "$APP_DEPLOY_STAMP" \
    app src lxc icons fonts astro.config.mjs package.json bun.lock bun.lockb \
    scripts/precompress.mjs scripts/build-app.sh Cargo.toml Cargo.lock; then
    echo "==> deploying lxc (app)"
    "$0" --device lxc "${extra[@]}"
    mkdir -p "$(dirname "$APP_DEPLOY_STAMP")"
    touch "$APP_DEPLOY_STAMP"
    did=1
  else
    echo "==> skipping lxc (no relevant changes)"
  fi
  if tree_changed_since "$BRIDGE_DEPLOY_STAMP" \
    bridge chain-print buildroot-external/board/ptlabel-pi0/overlay Cargo.toml Cargo.lock; then
    echo "==> deploying bridge"
    "$0" --device bridge "${extra[@]}"
    mkdir -p "$(dirname "$BRIDGE_DEPLOY_STAMP")"
    touch "$BRIDGE_DEPLOY_STAMP"
    did=1
  else
    echo "==> skipping bridge (no relevant changes)"
  fi
  [[ $did -eq 0 ]] && echo "==> nothing to deploy"
}

load_device() {
  local device_name="$1"
  local device_file="${ROOT}/devices/${device_name}.env"
  if [[ ! -f "$device_file" ]]; then
    echo "device profile not found: $device_file" >&2
    exit 1
  fi
  set -a
  # shellcheck source=/dev/null
  . "$device_file"
  set +a
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --static-only) STATIC_ONLY=1; shift ;;
    --all) ALL=1; shift ;;
    --device)
      DEVICE="${2:-}"
      if [[ -z "$DEVICE" ]]; then
        echo "--device requires a value" >&2
        exit 1
      fi
      shift 2
      ;;
    --device=*) DEVICE="${1#--device=}"; shift ;;
    *) HOST="$1"; shift ;;
  esac
done

if [[ $ALL -eq 1 ]] || [[ -z "$DEVICE" && -z "$HOST" ]]; then
  run_deploy_all
  exit 0
fi

if [[ -n "$DEVICE" ]]; then
  load_device "$DEVICE"
fi

PTLABEL_KIND="${PTLABEL_KIND:-}"
if [[ "$PTLABEL_KIND" != "bridge" && "$PTLABEL_KIND" != "app" ]]; then
  echo "PTLABEL_KIND must be set to bridge or app in device profile" >&2
  exit 1
fi
if [[ "$PTLABEL_KIND" == "bridge" && $STATIC_ONLY -eq 1 ]]; then
  echo "--static-only is meaningless for the bridge (no static UI)" >&2
  exit 1
fi

PTLABEL_MDNS_NAME="${PTLABEL_MDNS_NAME:-label}"
PTLABEL_PORT="${PTLABEL_PORT:-80}"
PTLABEL_DIAGNOSTICS="${PTLABEL_DIAGNOSTICS:-0}"
PTLABEL_STATIC_IPV4="${PTLABEL_STATIC_IPV4:-}"
PTLABEL_STATIC_GW="${PTLABEL_STATIC_GW:-}"
PTLABEL_STATIC_DNS="${PTLABEL_STATIC_DNS:-}"
BRIDGE_URL="${BRIDGE_URL:-http://bridge.local:7777}"
HOST="${HOST:-${PI_HOST:-}}"
if [[ -z "$HOST" ]]; then
  echo "PI_HOST missing; set in device profile or pass positional host" >&2
  exit 1
fi

SSH_OPTS=(-o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR -o BatchMode=yes)

if [[ "$PTLABEL_KIND" == "bridge" ]]; then
  if [[ $STATIC_ONLY -eq 0 && -f "$BRIDGE_BUILD_STAMP" ]]; then
    BRIDGE_RUST_CHANGED=0
    while IFS= read -r relpath; do
      file="${ROOT}/${relpath}"
      if [[ ! -f "$file" || "$file" -nt "$BRIDGE_BUILD_STAMP" ]]; then
        BRIDGE_RUST_CHANGED=1
        break
      fi
    done < <(git -C "$ROOT" ls-files bridge chain-print Cargo.toml Cargo.lock)
    if [[ $BRIDGE_RUST_CHANGED -eq 0 ]]; then
      echo "==> no bridge rust changes; skipping binary rebuild"
      STATIC_ONLY=1
    fi
  fi
  if [[ $STATIC_ONLY -eq 0 ]]; then
    "${ROOT}/scripts/br-build-flash.sh" --rust-only ${DEVICE:+--device "$DEVICE"}
    BIN="${ROOT}/.cache/ptlabel-bridge/bin/ptlabel-bridge"
    if [[ ! -f "$BIN" ]]; then
      echo "build did not produce $BIN" >&2
      exit 1
    fi
    SIZE_KB=$(( $(stat -f %z "$BIN") / 1024 ))
    echo "==> pushing ${SIZE_KB} KB bridge binary to ${HOST}"
    scp -O "${SSH_OPTS[@]}" "$BIN" "${HOST}:/opt/ptlabel/bin/ptlabel-bridge.new"
    mkdir -p "$(dirname "$BRIDGE_BUILD_STAMP")"
    touch "$BRIDGE_BUILD_STAMP"
  fi

  OVERLAY="${ROOT}/buildroot-external/board/ptlabel-pi0/overlay"
  scp -O "${SSH_OPTS[@]}" \
    "${OVERLAY}/etc/init.d/S20ptlabel" \
    "${HOST}:/etc/init.d/S20ptlabel"
  scp -O "${SSH_OPTS[@]}" \
    "${OVERLAY}/etc/init.d/S05wifi" \
    "${HOST}:/etc/init.d/S05wifi"
  scp -O "${SSH_OPTS[@]}" \
    "${OVERLAY}/etc/init.d/S60ptlabel-diagnostics" \
    "${HOST}:/etc/init.d/S60ptlabel-diagnostics"
  scp -O "${SSH_OPTS[@]}" \
    "${OVERLAY}/usr/bin/ptlabel-diagnostics" \
    "${HOST}:/usr/bin/ptlabel-diagnostics"

  DEFAULTS_FILE="$(mktemp)"
  trap 'rm -f "$DEFAULTS_FILE"' EXIT
  cat >"$DEFAULTS_FILE" <<EOF
PTLABEL_ROOT=/opt/ptlabel
PTLABEL_DATA_DIR=/opt/ptlabel/data
PTLABEL_PORT=${PTLABEL_PORT}
PTLABEL_MDNS_NAME=${PTLABEL_MDNS_NAME}
PTLABEL_DIAGNOSTICS=${PTLABEL_DIAGNOSTICS}
PTLABEL_STATIC_IPV4=${PTLABEL_STATIC_IPV4}
PTLABEL_STATIC_GW=${PTLABEL_STATIC_GW}
PTLABEL_STATIC_DNS=${PTLABEL_STATIC_DNS}
EOF
  scp -O "${SSH_OPTS[@]}" "$DEFAULTS_FILE" "${HOST}:/etc/default/ptlabel"

  ssh "${SSH_OPTS[@]}" "$HOST" STATIC_ONLY="$STATIC_ONLY" sh -s <<'EOS'
set -e
if [ "$STATIC_ONLY" = "0" ]; then
  chmod +x /opt/ptlabel/bin/ptlabel-bridge.new
  mv /opt/ptlabel/bin/ptlabel-bridge.new /opt/ptlabel/bin/ptlabel-bridge
fi
rm -f /etc/init.d/S35wifi
chmod +x /etc/init.d/S20ptlabel /etc/init.d/S05wifi /etc/init.d/S60ptlabel-diagnostics /usr/bin/ptlabel-diagnostics
/etc/init.d/S20ptlabel restart
/etc/init.d/S05wifi restart || true
/etc/init.d/S60ptlabel-diagnostics restart || true
sleep 2
echo "--- /status ---"
curl -fsS --max-time 3 http://127.0.0.1:7777/status || echo "status probe failed"
EOS
  exit 0
fi

if [[ $STATIC_ONLY -eq 0 && -f "$APP_BUILD_STAMP" ]]; then
  APP_RUST_CHANGED=0
  while IFS= read -r relpath; do
    file="${ROOT}/${relpath}"
    if [[ ! -f "$file" || "$file" -nt "$APP_BUILD_STAMP" ]]; then
      APP_RUST_CHANGED=1
      break
    fi
  done < <(git -C "$ROOT" ls-files app Cargo.toml Cargo.lock)
  if [[ $APP_RUST_CHANGED -eq 0 ]]; then
    echo "==> no app rust changes; skipping binary rebuild"
    STATIC_ONLY=1
  fi
fi

if [[ $STATIC_ONLY -eq 0 ]]; then
  "${ROOT}/scripts/build-app.sh"
  APP_BUILT=1
  BIN="${ROOT}/.cache/ptlabel-app/bin/ptlabel-app"
  if [[ ! -f "$BIN" ]]; then
    echo "build did not produce $BIN" >&2
    exit 1
  fi
  SIZE_KB=$(( $(stat -f %z "$BIN") / 1024 ))
  echo "==> pushing ${SIZE_KB} KB app binary to ${HOST}"
  scp -O "${SSH_OPTS[@]}" "$BIN" "${HOST}:/opt/ptlabel/bin/ptlabel-app.new"
fi

if [[ ! -f "${ROOT}/icons/category-sprite.png" ]]; then
  echo "icons/category-sprite.png missing; run: python3 scripts/build-icon-catalog.py" >&2
  exit 1
fi

echo "==> building static bundle"
( cd "$ROOT" && bun run build )

DIST="${ROOT}/static"
if [[ ! -d "$DIST" ]]; then
  echo "build did not produce $DIST" >&2
  exit 1
fi

scp -O -r "${SSH_OPTS[@]}" "$DIST" "${HOST}:/opt/ptlabel/static.new"

RSYNC_SSH="ssh ${SSH_OPTS[*]}"
echo "==> rsyncing fonts/ and icons/ to ${HOST} (delta)"
rsync -az --delete -e "$RSYNC_SSH" \
  "${ROOT}/fonts/" "${HOST}:/opt/ptlabel/fonts/"
rsync -az --delete -e "$RSYNC_SSH" \
  "${ROOT}/icons/" "${HOST}:/opt/ptlabel/icons/"

scp -O "${SSH_OPTS[@]}" \
  "${ROOT}/lxc/etc/init.d/ptlabel" \
  "${HOST}:/etc/init.d/ptlabel"

CONFD_FILE="$(mktemp)"
trap 'rm -f "$CONFD_FILE"' EXIT
cat >"$CONFD_FILE" <<EOF
PTLABEL_ROOT=/opt/ptlabel
PTLABEL_DATA_DIR=/opt/ptlabel/data
PTLABEL_PORT=${PTLABEL_PORT}
PTLABEL_MDNS_NAME=${PTLABEL_MDNS_NAME}
BRIDGE_URL=${BRIDGE_URL}
EOF
scp -O "${SSH_OPTS[@]}" "$CONFD_FILE" "${HOST}:/etc/conf.d/ptlabel"

ssh "${SSH_OPTS[@]}" "$HOST" STATIC_ONLY="$STATIC_ONLY" sh -s <<'EOS'
set -e
if [ "$STATIC_ONLY" = "0" ]; then
  chmod +x /opt/ptlabel/bin/ptlabel-app.new
  mv /opt/ptlabel/bin/ptlabel-app.new /opt/ptlabel/bin/ptlabel-app
fi
chmod +x /etc/init.d/ptlabel
rm -rf /opt/ptlabel/static.old
[ -d /opt/ptlabel/static ] && mv /opt/ptlabel/static /opt/ptlabel/static.old
mv /opt/ptlabel/static.new /opt/ptlabel/static
rm -rf /opt/ptlabel/static.old
rc-service ptlabel restart || /etc/init.d/ptlabel restart
rc-update add ptlabel default >/dev/null 2>&1 || true
sleep 2
echo "--- /api/status ---"
curl -fsS --max-time 3 http://127.0.0.1/api/status || echo "status probe failed"
EOS

if [[ $APP_BUILT -eq 1 ]]; then
  mkdir -p "$(dirname "$APP_BUILD_STAMP")"
  touch "$APP_BUILD_STAMP"
fi

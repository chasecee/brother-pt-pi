#!/usr/bin/env bash
set -euo pipefail

ROOT="${PTLABEL_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"
BRANCH="${PTLABEL_BRANCH:-main}"
BIN="$ROOT/bin/ptlabel-server"
RELEASE_ASSET="${PTLABEL_RELEASE_ASSET:-ptlabel-server-linux-arm64}"
RELEASE_TAG_FILE="$ROOT/data/.release-tag"
TOKEN="${PTLABEL_GITHUB_TOKEN:-${GITHUB_TOKEN:-}}"

repo_slug() {
  if [[ -n "${PTLABEL_GITHUB_REPO:-}" ]]; then
    echo "$PTLABEL_GITHUB_REPO"
    return
  fi
  local url slug
  url="$(git -C "$ROOT" remote get-url origin)"
  if [[ "$url" =~ github\.com[:/]([^/]+/[^/.]+)(\.git)?$ ]]; then
    slug="${BASH_REMATCH[1]}"
    echo "${slug%.git}"
    return
  fi
  echo "ptlabel-sync: cannot parse GitHub repo from origin ($url); set PTLABEL_GITHUB_REPO" >&2
  return 1
}

sync_binary() {
  local repo tag asset_url tmp py_out rc=0
  repo="$(repo_slug)"
  mkdir -p "$ROOT/bin" "$ROOT/data"

  py_out="$(
    PTLABEL_GITHUB_TOKEN="$TOKEN" python3 - "$repo" "$RELEASE_ASSET" <<'PY'
import json
import os
import sys
import urllib.error
import urllib.request

repo, asset_name = sys.argv[1:3]
token = os.environ.get("PTLABEL_GITHUB_TOKEN", "")

req = urllib.request.Request(f"https://api.github.com/repos/{repo}/releases/latest")
req.add_header("Accept", "application/vnd.github+json")
req.add_header("User-Agent", "ptlabel-sync")
if token:
    req.add_header("Authorization", f"Bearer {token}")

try:
    with urllib.request.urlopen(req, timeout=30) as resp:
        release = json.load(resp)
except urllib.error.HTTPError as e:
    if e.code == 404:
        sys.stderr.write("ptlabel-sync: no GitHub release yet\n")
        sys.exit(3)
    raise

tag = release.get("tag_name", "")
assets = [a for a in release.get("assets", []) if a.get("name") == asset_name]
if not assets:
    sys.stderr.write(f"ptlabel-sync: release {tag} missing asset {asset_name}\n")
    sys.exit(4)

asset = assets[0]
print(tag)
print(asset["url"])
PY
  )" || rc=$?

  if [[ "$rc" == 3 ]]; then
    return 1
  fi
  if [[ "$rc" != 0 ]]; then
    exit "$rc"
  fi

  mapfile -t _release <<<"$py_out"
  tag="${_release[0]}"
  asset_url="${_release[1]}"

  if [[ -f "$RELEASE_TAG_FILE" ]] && [[ "$(cat "$RELEASE_TAG_FILE")" == "$tag" ]] && [[ -x "$BIN" ]]; then
    echo "ptlabel-sync: binary up to date ($tag)"
    return 1
  fi

  echo "ptlabel-sync: downloading $RELEASE_ASSET ($tag)"
  tmp="$(mktemp)"
  PTLABEL_GITHUB_TOKEN="$TOKEN" python3 - "$asset_url" "$tmp" <<'PY'
import os
import sys
import urllib.request

url, dest = sys.argv[1:3]
token = os.environ.get("PTLABEL_GITHUB_TOKEN", "")

req = urllib.request.Request(url)
req.add_header("Accept", "application/octet-stream")
req.add_header("User-Agent", "ptlabel-sync")
if token:
    req.add_header("Authorization", f"Bearer {token}")

with urllib.request.urlopen(req, timeout=120) as resp, open(dest, "wb") as out:
    out.write(resp.read())
PY
  chmod +x "$tmp"
  mv "$tmp" "$BIN"
  echo "$tag" >"$RELEASE_TAG_FILE"
  echo "ptlabel-sync: installed $BIN ($tag)"
  return 0
}

cd "$ROOT"
echo "ptlabel-sync: $(date -Is) branch=$BRANCH"
HEAD_BEFORE="$(git rev-parse HEAD)"
git fetch origin "$BRANCH"
git pull --ff-only origin "$BRANCH"
HEAD_AFTER="$(git rev-parse HEAD)"

BIN_CHANGED=0
if sync_binary; then
  BIN_CHANGED=1
elif [[ ! -x "$BIN" ]]; then
  echo "ptlabel-sync: missing $BIN (wait for CI release or build locally)" >&2
  exit 1
fi

if [[ "$HEAD_BEFORE" != "$HEAD_AFTER" || "$BIN_CHANGED" == 1 ]]; then
  if command -v systemctl >/dev/null; then
    sudo systemctl restart ptlabel.service 2>/dev/null || systemctl --user restart ptlabel.service 2>/dev/null || true
  fi
fi

echo "ptlabel-sync: done"

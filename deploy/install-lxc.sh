#!/usr/bin/env bash
set -euo pipefail

ROOT="/opt/ptlabel"

mkdir -p "$ROOT/bin" "$ROOT/static" "$ROOT/data"

if [[ -f "./deploy/ptlabel-server.service" ]]; then
  cp "./deploy/ptlabel-server.service" "/etc/systemd/system/ptlabel-server.service"
fi

cat >/etc/logrotate.d/ptlabel-server <<'EOF'
/var/log/ptlabel-server.log {
  weekly
  rotate 8
  compress
  missingok
  notifempty
}
EOF

systemctl daemon-reload
systemctl enable ptlabel-server
echo "lxc bootstrap complete"

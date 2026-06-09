# PTLabel LXC Build Guide

## Goal
Run `ptlabel-server` in a Proxmox LXC and keep Caddy in front for HTTPS.

## Prereqs
- Proxmox node with Debian template available
- Caddy already running on LAN
- This repo on your Mac with Rust + `just`
- Bridge device reachable on LAN

## 1) Create LXC in Proxmox
Recommended baseline:
- Debian 12
- 1 vCPU
- 512 MB RAM
- 2 GB disk
- Static DHCP reservation

Optional CLI example on Proxmox host:
```bash
pct create 140 local:vztmpl/debian-12-standard_12.7-1_amd64.tar.zst \
  --hostname ptlabel \
  --cores 1 \
  --memory 512 \
  --rootfs local-lvm:2 \
  --net0 name=eth0,bridge=vmbr0,ip=dhcp \
  --unprivileged 1 \
  --onboot 1
pct start 140
```

## 2) Bootstrap inside LXC
```bash
apt update
apt install -y rsync ca-certificates
mkdir -p /opt/ptlabel/bin /opt/ptlabel/static /opt/ptlabel/data
```

Copy service installer from repo and run:
```bash
cd /opt/ptlabel
bash deploy/install-lxc.sh
```

## 3) Deploy from your Mac
Use host in `user@ip` format:
```bash
just deploy-server root@10.0.20.40
```

This command:
- cross-builds server for Linux musl
- copies binary + static assets
- installs/reloads `ptlabel-server.service`
- restarts service

## 4) Configure bridge target on LXC
Set bridge IP in systemd env:
```bash
sudo sed -i '' 's|PTLABEL_BRIDGE_ADDR=.*|PTLABEL_BRIDGE_ADDR=10.0.30.55:9100|' /etc/systemd/system/ptlabel-server.service
sudo systemctl daemon-reload
sudo systemctl restart ptlabel-server
```

## 5) Verify service
```bash
systemctl status --no-pager ptlabel-server
curl -fsS http://127.0.0.1:8080/api/status
curl -fsS http://10.0.30.55:8080/health
```

## 6) Reverse proxy + DNS
Point Caddy to LXC:
```caddy
label.lan.chase.dev {
    reverse_proxy 10.0.20.40:8080
}
```

Add AdGuard local rewrite:
- host: `label.lan.chase.dev`
- answer: Caddy LAN IP

## 7) Firewall rules
In OPNsense:
- allow `LXC_IP -> BRIDGE_IP tcp/9100`
- allow `LXC_IP -> BRIDGE_IP tcp/8080`
- block other client access to bridge ports

## Troubleshooting
- `deploy-server` fails on `cargo zigbuild`: install `zig` and `cargo-zigbuild`
- `api/status` shows down: verify `PTLABEL_BRIDGE_ADDR` and bridge reachability
- no logs: `journalctl -u ptlabel-server -n 100 --no-pager`

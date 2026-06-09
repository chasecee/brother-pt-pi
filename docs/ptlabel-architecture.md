# PTLabel Architecture

## Direction
Retire the Pi Zero. Keep rendering and app logic in a Proxmox LXC, move USB adjacency to an ESP32-S3 bridge, and keep the wire protocol raw and boring.

## Why
- Pi Zero is the bottleneck for everything (build, deploy, runtime).
- Network, TLS, and naming are already solved by OPNsense + Caddy + AdGuard.
- Bridge-per-printer scales linearly. Server-side renders stay where iteration is fast.

## Topology
`Browser -> Caddy (Proxmox) -> ptlabel-server LXC --TCP :9100--> ESP32-S3 bridge --USB host--> Brother PT`

## Hardware
**Bridge:** Lonely Binary ESP32-S3 Gold Edition, N16R8, dual USB-C, IPEX antenna (~$20, Amazon).
- Left USB-C (CH343): power, flash, serial console (`/dev/cu.wchusbserial*` on macOS).
- Right USB-C (native USB): OTG host path to printer with USB-C-to-USB-A OTG adapter.
- IPEX antenna attached before first power-on.
- Zero soldering, two cables.

**Server LXC:** Debian/Ubuntu, 1 vCPU / 512 MB / 2 GB disk.

## Bridge firmware (`ptlabel-bridge`)
ESP-IDF. One job: TCP <-> USB bulk.
- Wifi STA, static DHCP reservation, mDNS optional.
- TCP listen `:9100`, one client at a time.
- USB host raw bulk (PT-P710BT is vendor bulk, not USB Printer Class).
- Bytes from TCP -> USB bulk OUT. USB bulk IN -> TCP.
- LED: solid = wifi up, blink = USB device present, fast blink = active transfer.
- No protocol knowledge. Never needs to change as server features evolve.

## Server changes (`ptlabel-server`)
Runs plain HTTP on `:8080` behind Caddy and talks to bridge over TCP:
- remove TLS/mDNS/buildroot/Pi deployment artifacts
- replace host USB probing and direct libusb path with `PTLABEL_BRIDGE_ADDR`
- preserve queue/state/UI APIs

## Shared contracts
`protocol/` is the single source of truth:
- ports, VID/PID, packet sizes, mDNS service string
- bridge admin schemas (`BridgeHealth`, `BridgeInfo`)
- generated TS declarations (`src/types/generated/*.ts`)
- generated C header (`bridge-firmware/main/protocol.h`)

## Local development
- run `just dev` for `bridge-host` + `ptlabel-server` + Astro
- `bridge-host` gives local USB printer a production-like TCP tunnel on `127.0.0.1:9100`
- server always uses TCP path locally and in production

## Networking and reverse proxy

### Caddy
```caddy
label.lan.chase.dev {
    reverse_proxy 10.0.20.40:8080
}
```

### AdGuard rewrite
- domain: `label.lan.chase.dev`
- answer: `10.0.20.10` (Caddy IP)

### OPNsense firewall
- allow `PTLABEL_LXC_IP -> BRIDGE_IP tcp/9100`
- allow `PTLABEL_LXC_IP -> BRIDGE_IP tcp/8080`
- deny all other bridge access from user/client VLANs

## Migration steps
1. Flash bridge firmware and confirm `http://<bridge-ip>:8080/health`.
2. Run server locally with `PTLABEL_BRIDGE_ADDR=<bridge-ip>:9100` and print test label.
3. Provision LXC and install service (`deploy/install-lxc.sh` + `deploy/ptlabel-server.service`).
4. Deploy server and static assets (`just deploy-server <host>`).
5. Point Caddy + AdGuard, add OPNsense allow rules.
6. Power down Pi Zero.

## Not covered in this cut
- bridge-side TLS/auth
- OTA firmware updates
- captive portal wifi provisioning
- durable print queue persistence

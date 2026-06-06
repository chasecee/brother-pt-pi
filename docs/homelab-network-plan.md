# Homelab Network Plan

## Direction
Dedicated OPNsense router + UniFi demoted to APs/switches + service stack on Proxmox.

## Hardware
CWWK/Topton **N100, 4x i226-V 2.5GbE, 16GB, 500GB NVMe** (~$320). Disable NIC hardware offload in OPNsense.

## Topology
`ISP -> OPNsense (WAN) -> UniFi switch -> APs / Proxmox / clients`
- OPNsense: routing, firewall, DHCP, VLANs, schedules, WireGuard, IDS.
- UniFi controller: LXC on Proxmox. UDM retired.

## Proxmox LXCs
- **AdGuard Home** - LAN DNS, ad-block, per-client schedules, rewrites for `*.lan.chase.dev`.
- **Caddy** - reverse proxy, wildcard Let's Encrypt via Cloudflare DNS-01.
- **UniFi Network Application** - AP/switch controller.
- **Home Assistant** - calendar-aware scheduler, drives OPNsense/UniFi via API.
- **NetAlertX** - network probe + new-device alerts.

## Local domains + HTTPS
Own a real domain, use `*.lan.chase.dev` internally. One wildcard cert in Caddy covers everything. Add host = AdGuard rewrite + Caddy block + reload. Avoid `.local`.

## Scheduling (layered)
- DNS-layer: AdGuard per-client schedules.
- L3 cutoff: OPNsense Schedule objects + device-group aliases.
- Calendar logic: Home Assistant flips rules via API.

## Migration
1. Build OPNsense offline.
2. UniFi controller LXC on Proxmox, adopt gear.
3. Cutover WAN to OPNsense (~15 min).
4. Move DHCP, point clients at AdGuard.
5. Rebuild VLANs/rules/schedules.
6. Caddy + AdGuard rewrites.
7. Retire UDM.

## Gotchas
- Disable i226 NIC offloads.
- DHCP-issued DNS = AdGuard IP (not gateway).
- Configure DHCPv6-PD per VLAN early.

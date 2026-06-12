# Homelab Network Plan

## Direction

Dedicated OPNsense router + UniFi demoted to APs/switches + service stack on Proxmox.

## Hardware

oaknode (Topton-family) **N100, 4x i226-V 2.5GbE** barebone ($230) + used Samsung 8GB DDR5-5600 SODIMM M425R1GB4BB0-CWM (downclocks to 4800, single slot) + own 1TB NVMe (PCIe3.0 x4 slot). ~$290 all-in.

- Box: https://www.amazon.com/gp/product/B0G38W34LD
- RAM: https://www.ebay.com/itm/298401377150
- Disable i226 hardware offload in OPNsense. Memtest the stick on arrival. First boot can sit black 5-10 min (RAM training) - don't power-cycle.
  IDS deferred: add Suricata later for threat detection (fits in 8GB with a moderate ruleset). Note: IDS does not identify devices - device accountability is handled by the allowlist design below.

## Network growth path

WAN is 1G fiber (any box handles it); target is 2.5GbE internal for AI workloads + file shares.

1. Router first: new OPNsense box, all four ports 2.5G-capable from day one.
2. 2.5G switch: UniFi Flex 2.5G, no PoE needed; uplink to OPNsense at 2.5G.
3. Endpoints: 2.5G NIC in PVE host + workstation. APs (U6/U6-LR, own PoE in place) untouched; 1G uplink is plenty for WiFi clients.

- Keep heavy talkers (AI box, NAS, workstation) on the same VLAN so bulk transfers switch at line rate; inter-VLAN traffic hairpins through OPNsense and caps at its 2.5G uplink.

## Topology

`ISP -> OPNsense (WAN) -> UniFi switch -> APs / Proxmox / clients`

- OPNsense: routing, firewall, DHCP, VLANs, schedules, WireGuard.
- UniFi controller: LXC on Proxmox. UDM retired.

## Proxmox LXCs

- **AdGuard Home** - LAN DNS, ad-block, per-client schedules, rewrites for `*.lan.chase.dev`.
- **Caddy** - reverse proxy, wildcard Let's Encrypt via Cloudflare DNS-01.
- **UniFi Network Application** - AP/switch controller.
- **Scheduler (custom)** - small self-built service + web UI, drives OPNsense/AdGuard via their REST APIs.
- **NetAlertX** - network probe + new-device alerts.

## Local domains + HTTPS

Own a real domain, use `*.lan.chase.dev` internally. One wildcard cert in Caddy covers everything. Add host = AdGuard rewrite + Caddy block + reload. Avoid `.local`.

## Scheduling (layered)

- DNS-layer: AdGuard per-client schedules.
- L3 cutoff: OPNsense Schedule objects + device-group aliases.
- Calendar/override logic: custom scheduler LXC flips rules via API.

## Device identity (MAC randomization defense)

Allowlist, don't chase: known MACs get assigned to person/group aliases; any unknown MAC defaults to the most restricted policy (kid schedule or no internet). Re-randomizing a MAC = demotion to default, so evasion punishes itself.

- NetAlertX alerts on every new MAC.
- Scheduler UI = registration point: assign new device to person/group, writes OPNsense alias.
- Phones randomize per-SSID and stay stable by default; only manual re-randomization triggers, and that lands in the restricted bucket.

## Custom scheduler

Own LXC on PVE. Plenty simple to build:

- OPNsense REST API (key/secret): toggle firewall rules or swap device-group aliases, then `filter/apply`.
- AdGuard Home API: flip per-client blocked services/schedules.
- Core = cron-style rule engine + the two API clients; UI = a few toggles, schedule editor, "pause internet for X" overrides.
- Stateless config in one file -> trivially backed up/rebuilt.

## Migration

1. Build OPNsense offline.
2. UniFi controller LXC on Proxmox, adopt gear.
3. Cutover WAN to OPNsense (~15 min).
4. Move DHCP, point clients at AdGuard.
5. Rebuild VLANs/rules/schedules.
6. Caddy + AdGuard rewrites.
7. Retire UDM.

## Failover

Principle: PVE dying must never break basic internet. Routing/DHCP/DNS-fallback all live on the OPNsense box.

- **DNS**: Unbound on OPNsense as resolver #2; DHCP hands out AdGuard then OPNsense. PVE down = no ad-block, internet fine.
- **Scheduler**: OPNsense rules default-allow, scheduler applies blocks. Scheduler death = rules freeze open, never locked out.
- **Caddy/UniFi/NetAlertX down**: cosmetic only. APs forward traffic without controller.
- **OPNsense box dies**: config = one XML file, auto-backed via `os-git-backup` plugin. UDM kept as dumb cold spare.
- **PVE dies**: nightly `vzdump` of LXCs to external storage; all containers stateless-ish, restore in minutes.

## Gotchas

- Disable i226 NIC offloads.
- DHCP-issued DNS = AdGuard IP (not gateway).
- Configure DHCPv6-PD per VLAN early.

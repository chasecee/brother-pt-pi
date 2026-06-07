# PTLabel Architecture

## Direction
Retire the Pi Zero. Split into a Proxmox LXC (renders) + an ESP32-S3 USB bridge (dumb tunnel to printer).

## Why
- Pi Zero is the bottleneck for everything (build, deploy, runtime).
- Network + TLS + mDNS already solved by OPNsense/Caddy/AdGuard - duplicating it in-app is cruft.
- Bridge-per-printer scales linearly. Server-side renders stay where iteration is fast.

## Topology
`Browser -> Caddy (Proxmox) -> ptlabel-server LXC --TCP :9100--> ESP32-S3 bridge --USB host--> Brother PT`

## Hardware
**Bridge:** Lonely Binary ESP32-S3 Gold Edition, N16R8, dual USB-C, IPEX antenna (~$20, Amazon).
- USB-C #1 (UART): power + programming + serial console from any USB-C wall wart.
- USB-C #2 (OTG): host port. USB-C-to-USB-A OTG adapter (~$2), printer's existing USB-A cable plugs in.
- IPEX antenna attached before first power-on.
- Zero soldering, two cables.

**Server:** new LXC on Proxmox, 1 vCPU / 512 MB / 2 GB disk. Plenty.

## Bridge firmware (`ptlabel-bridge`)
ESP-IDF, ~200 lines C. One job: TCP <-> USB bulk.
- Wifi STA, static DHCP reservation, mDNS optional.
- TCP listen :9100 (JetDirect convention). One client at a time.
- TinyUSB host, printer class (or raw bulk if vendor-specific).
- Bytes from TCP -> USB bulk OUT. USB bulk IN -> TCP.
- `STATUS\n` line out-of-band -> reply with cached device descriptor + last status bytes.
- LED: solid = wifi up, blink = USB device present, fast blink = active transfer.
- No protocol knowledge. Never needs to change as server features evolve.

## Server changes (`ptlabel-server`)
Becomes plain HTTP behind Caddy. Delete:
- `tls.rs`, `rustls*`, `axum-server`, cert generation, `scripts/gen-tls-cert.sh`
- `spawn_http_redirect`, `:80` listener
- `advertise_mdns`, `mdns-sd` dep (Caddy + AdGuard rewrite handles `label.lan.chase.dev`)
- `buildroot-external/board/ptlabel-pi0/*` (no more Pi image)
- Pi-specific bits of `deploy.sh`

Rewrite `printer.rs`: drop libusb, replace with a TCP client to the bridge. Same public API to the rest of the server, so `main.rs` and the queue logic are untouched.

Net: ~500 LOC + a whole buildroot tree gone.

## Network trust
- Bridge pinned to OPNsense firewall rule: only the LXC IP can talk to it on :9100. No PSK needed.
- Caddy fronts HTTPS publicly via wildcard cert. App speaks plain HTTP on `127.0.0.1:8080`.

## Migration
1. Server: gut TLS/mDNS/buildroot, swap libusb for TCP printer driver, run locally pointing at a stub.
2. Bridge: flash firmware, confirm printer enumerates over wifi using `nc <bridge-ip> 9100`.
3. Build LXC, deploy server binary + static assets.
4. Caddy site for `label.lan.chase.dev` -> LXC :8080.
5. Power down Pi Zero, never power back on.

## Future
- Second printer = second bridge. Server picks IP per print job.
- Status display: Waveshare RP2350-LCD-1.28 boards subscribe to server SSE for queue/state. (Needs wifi co-processor or wired uplink - parking this.)
- OTA bridge updates: skip. ~200 LOC firmware. USB reflash is fine.

## Gotchas
- Attach IPEX antenna before powering wifi or the radio can be damaged.
- ESP32-S3 OTG VBUS: confirm 5V appears on the host port; some boards need a GPIO toggle to enable boost.
- Printer is self-powered; bridge only needs VBUS sense, not current sourcing.
- Brother PT USB class: confirm standard Printer Class vs vendor-specific bulk before locking in TinyUSB API.

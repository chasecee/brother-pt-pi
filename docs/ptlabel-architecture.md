# PTLabel Architecture

## Current state (live)

Split landed: Proxmox LXC renders/serves, Pi Zero W is a dumb USB bridge.

`Browser -> ptlabel-app (LXC :80) --HTTP :7777--> ptlabel-bridge (Pi Zero W) --USB--> Brother PT`

- App: `app/` crate, Alpine LXC, OpenRC service `ptlabel`. `devices/lxc.env`.
- Bridge: `bridge/` crate on a Buildroot image (`buildroot-external/`),
  BusyBox init `S20ptlabel`. `devices/bridge.env`.
- The app pins the bridge by IP (`BRIDGE_URL`); naming/TLS belongs to
  OPNsense/Caddy/AdGuard, not the app.

## Endgame: ESP32-S3 bridge (parked)

Replace the Pi Zero bridge with an ESP32-S3 USB-host board: sub-second boot,
no SD card, no Buildroot tree, no kernel/wifi-firmware boot path.

**Hardware:** Lonely Binary ESP32-S3 Gold Edition, N16R8, dual USB-C, IPEX
antenna (~$20). UART USB-C for power/flash, OTG USB-C to the printer via
USB-A adapter. Zero soldering.

**Firmware:** ESP-IDF, ~200 lines C. TCP :9100 <-> USB bulk, one client at a
time, `STATUS\n` out-of-band. No protocol knowledge — never changes as server
features evolve. OTA: skip; USB reflash is fine.

**Server change:** swap the bridge HTTP client for a TCP :9100 client (or
move chain-print into the app and stream raster bytes). Public API unchanged.

**Gotchas captured from the first attempt:**

- Attach the IPEX antenna before powering wifi.
- Confirm 5V on the OTG port; some boards gate VBUS behind a GPIO.
- Confirm Brother PT USB class (printer class vs vendor bulk) before locking
  in the TinyUSB API.

## Future

- Second printer = second bridge; app picks IP per print job.
- Status displays (RP2350-LCD-1.28 subscribing to app SSE) — parked.

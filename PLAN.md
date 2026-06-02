# ptlabel

Local web UI for Brother PT-P710BT label printing.

Browser on the LAN -> type labels, queue them, preview (client-side), print.
Rust `ptlabel-server` + browser Canvas/opentype.js rendering + chain-print over USB.

## Stack

- **Render:** browser Canvas + opentype.js (`static/js/render.js`); Brother fonts from `/fonts/`
- **Server:** Rust `ptlabel-server` (axum) — state, static assets, USB print/media
- **Print:** `chain-print` library (vendored `ptouch` crate) over USB with chain cuts
- **UI:** static `index.html`; shared state on Pi (`data/state.json`)

```
Browser -> render.js (preview + print PNG)
        -> ptlabel-server -> state.json
                         -> chain-print (USB) -> PT-P710BT
```

## Mac development

```bash
make mac-dev
# http://127.0.0.1:5001
```

Requires:
- Rust toolchain (`cargo build --release -p ptlabel-server`)
- Brother fonts synced once: `make fonts`

Quit Brother P-touch apps before printing; they hold the USB device.

## Pi deployment (Pi Zero W 1.1)

Target: custom Buildroot image (`ptlabel_pi0_defconfig`), ARMv6 + VFPv2, BusyBox
init, dropbear SSH, chrony NTP. See [BUILDROOT.md](BUILDROOT.md) for the full
flow and the toolchain rationale.

USB printer on the Pi's data micro-USB port (inner, not the PWR one). Keep the
printer on AC power.

### Printer power settings (one-time, via Brother app)

The printer manages its own power. Configure once via Brother's
**Printer Setting Tool** (Windows):

- **Auto Power On** = enabled (printer wakes on USB activity)
- **Auto Power Off** = disabled, or set to a long interval

With those set, the printer stays addressable from the Pi without any
host-side intervention.

### First flash

```bash
cp buildroot-external/board/ptlabel-pi0/wpa_supplicant.conf.example \
   buildroot-external/board/ptlabel-pi0/wpa_supplicant.conf
# edit the new file with your SSID/PSK, then:
./scripts/br-build-flash.sh --disk /dev/diskN
```

### Daily dev (no reflash)

```bash
make mac-dev       # iterate locally
./deploy.sh        # cross-build for ARMv6 and push to live Pi
```

`deploy.sh` rebuilds the Rust binary against Buildroot's toolchain, `scp`s it
into `/opt/ptlabel/bin/`, restarts `S50ptlabel`, and prints `/api/status` plus
the new log tail.

## chain-print

Prints multiple label PNGs in one USB session with chain cuts between labels:

```bash
chain-print --pad 0 label1.png label2.png label3.png
```

Built from `chain-print/` which vendors the `ptouch` Rust library.
Mac uses `no_reset: true` in connect options to avoid USB re-enumeration issues.

## Environment

| Variable | Default | Purpose |
|----------|---------|---------|
| `CHAIN_PRINT` | auto-detect | Path to chain-print binary |
| `CHAIN_PRINT_PAD` | `0` | Padding pixels between labels |
| `LABEL_FONT_SIZE` | `76` | Default font size (18 mm baseline; overridden by detected media) |
| `TAPE_HEIGHT_PX` | `112` | Tape height in pixels (18 mm baseline; overridden by detected media) |
| `TAPE_HEIGHT_MM` | `18` | Tape height for UI scale (18 mm baseline; overridden by detected media) |
| `PTLABEL_DATA_DIR` | `./data` | Directory for `state.json` (prefs, draft, queue, recent) |

Env vars remain the fallback when the printer is unavailable or media cannot be read.

## Media detection

The PT-P710BT reports loaded tape over USB via `ESC i S` (32-byte status). The vendored `ptouch` crate already parses this on connect; we just do not expose it yet.

**Readable today**

| Field | Status byte | Notes |
|-------|-------------|-------|
| Width | 10 | mm (6, 9, 12, 18, 24) |
| Kind | 11 | laminated, non-laminated, flexible, heat-shrink |
| Tape color | 24 | white, red, blue, clear, etc. |
| Text color | 25 | black, white, red, etc. |
| Errors | 8–9 | no media, wrong media, cover open, etc. |

**Maybe later:** remaining tape length from status bytes 13 + 17 — present in Brother's protocol but not parsed or verified on the P710BT yet.

**Query path**

1. `chain-print --status-json` emits structured status after connect.
2. `GET /api/media` calls chain-print, returns width/kind/colors/errors.
3. Periodic refresh triggers the query; skip while printing (USB lock held by chain-print).

**Timing:** status query is one USB round trip (~0.5–2 s including connect). Passive USB enumeration (`ioreg`/`lsusb`) stays instant and remains the fast path for "device visible" checks during print.

## Width presets

Current defaults are tuned for **18 mm** tape (112 px print height, 76 pt font, 24 px margin, v_align 4). These match `ptouch` print areas for TZe18mm: `(8, 112, 8)`.

When media is detected, apply a preset for that width. Scale linearly from the 18 mm baseline:

```
preset_value = round(baseline_18mm * height_px / 112)
```

| Width | height_px | font_size | margin_h | v_align |
|-------|-----------|-----------|----------|---------|
| 6 mm  | 32        | 21        | 7        | 1       |
| 9 mm  | 50        | 33        | 11       | 2       |
| 12 mm | 70        | 46        | 15       | 3       |
| 18 mm | 112       | 76        | 24       | 4       |
| 24 mm | 128       | 85        | 27       | 6       |

`height_px` values come from `ptouch::device::Media::area()` center column. Heat-shrink widths use their own areas if we ever support them.

**Behavior**

- Detected media sets render height and UI tape scale (`TAPE_HEIGHT_PX` / `TAPE_HEIGHT_MM` equivalents).
- Preset values become the default for new labels and the settings panel when tape width changes.
- User overrides in the queue persist per label; changing tape does not rewrite existing rows.
- Show detected tape in status, e.g. `18 mm · white/black` or `no media`.
- Tape/text color is informational for now; preview stays monochrome. Could later tint preview background to match tape color.

| `LABEL_PAD_PX` | `24` | Default horizontal margin (18 mm baseline; overridden by detected media) |

Shared state lives in `{PTLABEL_DATA_DIR}/state.json`. All browsers on the LAN read/write via `/api/state`. Recent prints are recorded server-side on successful print.

## API

- `GET /` — UI
- `GET /api/config` — UI defaults, limits, baseline tape height
- `GET /api/state` — prefs, draft, queue, recent
- `PUT /api/state` — update prefs, draft, and/or queue
- `GET /api/status` — printer USB presence + printing flag (passive, safe during print)
- `GET /api/media` — query loaded tape via USB (width, kind, colors, errors); skip if printing
- `GET /api/fonts` — font catalog with `/fonts/` URLs per variant
- `POST /api/print` — print pre-rendered PNGs (`{ png, qty, meta }` per label); records recent on success

## UI behavior

- Shared state on Pi is authoritative; no browser localStorage for queue/draft/prefs/recent
- Textarea holds label text, one line per label — it is the editor, not a staging area
- Draft saves immediately on input; labels sync after 500ms idle
- Status: passive USB check for connected/printing; media details from `/api/media` on load and periodic refresh (not during print)
- Detected width applies preset defaults to settings panel; preview tape height scales with width
- Each row: preview image, quantity, Print button
- Header: label count + Print all (one chain tape run)
- Recently printed section below queue: loaded from Pi state, preview + qty + Add

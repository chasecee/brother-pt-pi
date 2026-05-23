# ptlabel

Local web UI for Brother PT-P710BT label printing.

Browser on the LAN -> type labels, queue them, preview, print.
Flask app + PIL rendering + chain-print binary for USB chain printing.

## Stack

- **Render:** Python/Pillow (`render.py`) with Brother fonts synced from P-touch Editor on Mac
- **Print:** Rust `chain-print` binary (vendored `ptouch` crate) over USB with chain cuts
- **UI:** Flask + single-page template with localStorage queue persistence

```
Browser -> app.py -> render.py (PIL PNG)
                 -> printer.py -> chain-print (USB) -> PT-P710BT
```

## Mac development

Native dev with USB micro cable to the printer:

```bash
make mac-dev
# http://127.0.0.1:5001
```

Requires:
- Rust toolchain (`cargo build --release` in `chain-print/`)
- Python venv (created automatically)
- Brother fonts synced once: `make fonts`

Quit Brother P-touch apps before printing; they hold the USB device.

## Pi 4B deployment

Target: **Raspberry Pi 4B**, Raspberry Pi OS **64-bit** (Bookworm), Docker + Compose.

Printer on Pi USB (USB-A to micro-USB). Keep the printer on AC power; sleep drops USB.
Docker runs with USB passthrough (`privileged: true`, `/dev/bus/usb` mount).

### Daily dev (push from Mac, auto-rebuild on Pi)

Pi polls GitHub every 60s; no public IP or GitHub Actions required.

```bash
# Mac
make mac-dev
git push                    # Pi picks up within ~60s

# Pi — one-time bootstrap
./scripts/pi-bootstrap.sh git@github.com:you/brother-pt-pi.git
```

Bootstrap installs a systemd timer (`ptlabel-watch.timer`) that runs `git fetch`, pulls on new commits, and runs `scripts/pi-rebuild.sh`.

Manual rebuild on Pi:

```bash
~/ptlabel/scripts/pi-rebuild.sh
```

Verify after deploy:

```bash
~/ptlabel/scripts/pi-verify.sh
```

### Bootstrap fallback (tarball, no git remote yet)

Build arm64 image on Mac, ship to Pi:

```bash
make build
make deploy HOST=pi@raspberrypi.local
```

Or on Pi with repo already cloned:

```bash
make build && make run
```

### Pi prerequisites

- Raspberry Pi OS 64-bit (arm64)
- Docker Engine + Compose plugin
- Git read access to repo (deploy key for private repos)
- One-time on Mac: `make fonts` then commit `fonts/` so Pi rebuilds match Mac rendering

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
| `LABEL_FONT_SIZE` | `74` | Default font size |
| `TAPE_HEIGHT_PX` | `112` | Tape height in pixels |
| `TAPE_HEIGHT_MM` | `18` | Tape height for UI scale |
| `LABEL_PAD_PX` | `16` | Default horizontal margin |

## API

- `GET /` — UI
- `GET /api/status` — printer USB presence
- `GET /api/fonts` — font catalog
- `POST /api/preview` — render label to PNG (base64)
- `POST /api/print` — print labels (supports `qty` per label)

## UI behavior

- One `labels[]` list is the source of truth (persisted in `localStorage` as `ptlabel.state`, including draft textarea text)
- Textarea holds label text, one line per label — it is the editor, not a staging area
- Draft saves immediately on input; labels sync after 500ms idle
- Status uses passive USB enumeration (`ioreg`/`lsusb`) — safe during print; shows `printing` while chain-print holds the device
- Each row: preview image, quantity, Print button
- Header: label count + Print all (one chain tape run)
- Recently printed section below queue: persisted in `ptlabel.recent`, preview + qty + Add

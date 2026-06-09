# ptlabel

Local web UI for Brother PT-P710BT label printing.

Browser on the LAN -> type labels, queue them, preview (client-side), print.

## Topology

```
Browser -> ptlabel-app (Proxmox LXC, :80) -> state.json, fonts, icons
                |
                v  HTTP /print, /status, /media
        ptlabel-bridge (Pi Zero W, :7777) -> chain-print -> USB -> PT-P710BT
```

- **App** (`app/`, Rust `ptlabel-app`, axum): UI host, shared state, font/icon
  catalogs, proxies print/status/media to the bridge. Runs in an Alpine LXC
  (x86_64 musl). `devices/lxc.env`.
- **Bridge** (`bridge/`, Rust `ptlabel-bridge`, axum): dumb USB endpoint —
  accepts PNGs, prints via `chain-print`, reports printer status/media. Runs on
  a Pi Zero W Buildroot image. `devices/bridge.env`. See [BUILDROOT.md](BUILDROOT.md).
- **Render**: browser Canvas + opentype.js (`src/scripts/render.ts`); Brother
  fonts from `/fonts/`. UI is a static Astro build (`src/` -> `static/`).
- **Print**: `chain-print/` library (vendored `ptouch` crate) over USB with
  chain cuts between labels.

## Development

```bash
make mac-dev        # native app on http://127.0.0.1:5001
bun run dev         # Astro dev server on :4321, proxies /api to :5001
make fonts          # one-time Brother font sync
```

Quit Brother P-touch apps before printing; they hold the USB device.

## Deployment

```bash
./deploy.sh --device lxc      # app: rust binary + static bundle + fonts/icons
./deploy.sh --device bridge   # bridge: ARMv6 cross-build + init scripts
make deploy DEVICE=lxc        # skips rust rebuild when unchanged
```

Bridge image build/flash: [BUILDROOT.md](BUILDROOT.md).

## Printer power (one-time, via Brother Printer Setting Tool on Windows)

- **Auto Power On** = enabled (printer wakes on USB activity)
- **Auto Power Off** = disabled

With those set, the printer stays addressable from the bridge without
host-side intervention.

## API (app, :80)

- `GET /` — UI
- `GET /api/config` — UI defaults, limits, baseline tape height
- `GET /api/state` / `PUT /api/state` — prefs, draft, queue, recent
- `GET /api/status` — bridge + printer presence, printing flag, sysinfo
- `GET /api/media` — loaded tape via bridge (width, kind, colors, errors)
- `GET /api/fonts` — font catalog with `/fonts/` URLs per variant
- `GET /api/icons*` — icon catalog, search, custom uploads
- `POST /api/print` — pre-rendered PNGs (`{ png, qty, meta }` per label)

## Bridge API (:7777)

- `GET /status` — printer USB presence + printing flag
- `GET /media` — tape status over USB (skipped while printing)
- `POST /print` — `{ labels: [{ png_b64, qty }] }`, chain-printed in one run

## Media detection

The PT-P710BT reports loaded tape over USB (`ESC i S`, 32-byte status): width
(6/9/12/18/24 mm), kind, tape/text color, errors. The bridge queries it on
`/media`; detected width drives render height and UI presets.

Width presets scale from the 18 mm baseline (112 px, 76 pt font, 24 px margin):

| Width | height_px | font_size | margin_h |
|-------|-----------|-----------|----------|
| 6 mm  | 32        | 21        | 7        |
| 9 mm  | 50        | 33        | 11       |
| 12 mm | 70        | 58*       | 15       |
| 18 mm | 112       | 76        | 24       |
| 24 mm | 128       | 85        | 27       |

(* 12 mm is hand-tuned, see `preset_for_width` in `bridge/src/main.rs`.)

## UI behavior

- Shared state on the app is authoritative; no browser localStorage
- Textarea is the editor, one line per label; draft saves on input, labels
  sync after 500ms idle
- Status: bridge polled for connected/printing; media on load + periodic
  refresh (not during print)
- Each row: preview image, quantity, Print button; header has Print all
  (one chain tape run); recently printed below the queue

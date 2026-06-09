# Buildroot flow (Pi Zero W 1.1)

Target hardware: Raspberry Pi Zero W (BCM2835, ARM1176JZF-S = ARMv6 + VFPv2,
BCM43438 Wi-Fi). No Ethernet, no RTC.

## Host requirements (macOS)

- Xcode command line tools (`git`, `curl`)
- Docker Desktop
- `sshpass` for `./deploy.sh`: `brew install hudochenkov/sshpass/sshpass`

## Wi-Fi credentials + SSH key (gitignored)

Copy `buildroot-external/board/ptlabel-pi0/wpa_supplicant.conf.example` to
`buildroot-external/board/ptlabel-pi0/wpa_supplicant.conf` and set your
SSID/PSK. Put your SSH public key at
`buildroot-external/board/ptlabel-pi0/authorized_keys` (e.g.
`cp ~/.ssh/id_ed25519.pub buildroot-external/board/ptlabel-pi0/authorized_keys`).
The post-build step installs both into the image and fails the build if either
is missing — `deploy.sh` and `pi-boot-report.sh` need key auth.

## One-command build and flash

```bash
./scripts/br-build-flash.sh --device bridge --disk /dev/diskN
./scripts/br-build-flash.sh --device bridge --build-only
```

The command:

1. clones/pins Buildroot into `.cache/buildroot`
2. builds the Buildroot cross toolchain into the `ptlabel-buildroot-out-pi0` Docker volume
3. cross-compiles `ptlabel-bridge` (Rust, ARMv6+VFPv2) using that toolchain into `.cache/ptlabel-bridge/bin/`
4. builds `ptlabel_pi0_defconfig` into `.cache/buildroot-out/pi0`, picking up the local binary
5. flashes `.cache/buildroot-out/pi0/images/sdcard.img` to the specified disk

Subsequent runs reuse the cached Buildroot toolchain and cargo target dir, so
only changed Rust files recompile. The rootfs target dir is scrubbed and the
kernel config re-merged on every image build — Buildroot's incremental target
dir never deletes files that overlays/packages stop installing, and it does
not track config fragment changes, so stale files would otherwise ship
forever. Use `--build-only` to build the image without flashing.

## Why the Rust build looks the way it does

Pi Zero W only understands ARMv6 + VFPv2. Two things would otherwise produce
a binary tagged ARMv7 + VFPv3-D16 (which segfaults on first instruction):

- rustup's precompiled stdlib for `arm-unknown-linux-gnueabihf` is built with
  v7 attributes. We use nightly + `-Z build-std=std,panic_abort` to rebuild it
  with our `target-cpu=arm1176jzf-s` flags.
- Ubuntu's `gcc-arm-linux-gnueabihf` ships only v7-A multilib for `crt*.o` and
  `libgcc.a`. The linker promotes ARM ELF attributes to the highest input tag,
  so even one v7 startup object poisons everything. We use Buildroot's
  `arm-buildroot-linux-gnueabihf-gcc` instead — its sysroot is built for
  ARM1176JZF-S.

`scripts/br-build-flash.sh` verifies `Tag_CPU_arch: v6*` and `Tag_FP_arch: VFPv2`
on the output and aborts otherwise.

## Flash-only loop

```bash
./scripts/br-build-flash.sh --flash-only --disk /dev/diskN
```

## Fast dev iteration (no reflash)

Once the Pi has been booted from an SD card once, push code changes straight
to the running Pi over Wi-Fi:

```bash
./deploy.sh --device bridge       # load devices/bridge.env
./deploy.sh root@192.168.1.42     # different host
```

It rebuilds the Rust binary (incremental — usually a few seconds), `scp`s it
into `/opt/ptlabel/bin/`, restarts `S20ptlabel`, and probes `/status`.

## Makefile shortcuts

```bash
make br-build DISK=/dev/diskN     # full image + flash
make br-flash DISK=/dev/diskN     # flash existing image
make br-rust                      # cross-build Rust only
make deploy                       # cross-build + push to live Pi
```

## On-Pi diagnostics

`tty1` shows live status from `/usr/bin/ptlabel-diagnostics`:

- Wi-Fi link + IP + SSH creds
- `brcmfmac` driver state
- `/status` snapshot
- tail of `/var/log/wifi.log` (from `S05wifi`) and `/var/log/ptlabel/bridge.log`

## Buildroot outputs

- Buildroot source: `.cache/buildroot`
- Buildroot per-target build (image + sysroot + host toolchain): Docker volume `ptlabel-buildroot-out-pi0`
- Buildroot download cache: Docker volume `ptlabel-buildroot-dl`
- Cargo registry cache: Docker volume `ptlabel-cargo-cache`
- Rust target dir + rustup toolchains: `.cache/ptlabel-bridge/`
- Flash image: `.cache/buildroot-out/pi0/images/sdcard.img`

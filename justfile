set shell := ["bash", "-eu", "-o", "pipefail", "-c"]

gen-protocol:
    cargo run -p protocol --bin gen-ts
    cargo run -q -p protocol --bin gen-c-header > bridge-firmware/main/protocol.h

check-protocol:
    just gen-protocol
    git diff --exit-code -- bridge-firmware/main/protocol.h src/types/generated

check:
    just check-protocol
    cargo check --workspace

test:
    cargo test --workspace

build-icons:
    python3 scripts/build-icon-catalog.py

build-fonts:
    python3 scripts/build-font-catalog.py

build-ui:
    bun run build

dev:
    PIDS=(); trap 'for p in "${PIDS[@]}"; do kill "$p" 2>/dev/null || true; done' EXIT; \
    cargo run -p ptlabel-bridge-host -- --tunnel-port 9100 --admin-port 8081 & PIDS+=($!); \
    PTLABEL_BRIDGE_ADDR=127.0.0.1:9100 cargo run -p ptlabel-server -- --port 5001 --dev & PIDS+=($!); \
    bun run dev

dev-live:
    PIDS=(); trap 'for p in "${PIDS[@]}"; do kill "$p" 2>/dev/null || true; done' EXIT; \
    cargo run -p ptlabel-bridge-host -- --tunnel-port 9100 --admin-port 8081 & PIDS+=($!); \
    PTLABEL_BRIDGE_ADDR=127.0.0.1:9100 cargo watch -w server -w chain-print -w protocol -x "run -p ptlabel-server -- --port 5001 --dev" & PIDS+=($!); \
    bun run dev

fw-info:
    . ~/esp/esp-idf/export.sh; \
    PORT=$(ls /dev/cu.* /dev/tty.* 2>/dev/null | rg -m1 "wchusbserial|usbmodem|usbserial|SLAB|ttyACM|ttyUSB" || true); \
    if [ -z "$PORT" ]; then echo "No ESP32 serial port found."; ls /dev/cu.* /dev/tty.* 2>/dev/null | rg -i "usb|serial|modem|SLAB|wch" || true; exit 1; fi; \
    esptool.py --chip esp32s3 --port "$PORT" chip_id; \
    esptool.py --chip esp32s3 --port "$PORT" flash_id; \
    espefuse.py --chip esp32s3 --port "$PORT" summary

fw-menuconfig:
    . ~/esp/esp-idf/export.sh; cd bridge-firmware && idf.py menuconfig

fw-build:
    just gen-protocol
    . ~/esp/esp-idf/export.sh; cd bridge-firmware && idf.py build

fw-flash:
    just gen-protocol
    . ~/esp/esp-idf/export.sh; PORT=$(ls /dev/cu.* /dev/tty.* 2>/dev/null | rg -m1 "wchusbserial|usbmodem|usbserial|SLAB|ttyACM|ttyUSB" || true); if [ -z "$PORT" ]; then echo "No ESP32 serial port found."; exit 1; fi; cd bridge-firmware && idf.py -p "$PORT" flash

fw-monitor:
    . ~/esp/esp-idf/export.sh; PORT=$(ls /dev/cu.* /dev/tty.* 2>/dev/null | rg -m1 "wchusbserial|usbmodem|usbserial|SLAB|ttyACM|ttyUSB" || true); if [ -z "$PORT" ]; then echo "No ESP32 serial port found."; exit 1; fi; cd bridge-firmware && idf.py -p "$PORT" monitor

fw-flash-monitor:
    just fw-flash
    just fw-monitor

fw-erase:
    . ~/esp/esp-idf/export.sh; PORT=$(ls /dev/cu.* /dev/tty.* 2>/dev/null | rg -m1 "wchusbserial|usbmodem|usbserial|SLAB|ttyACM|ttyUSB" || true); if [ -z "$PORT" ]; then echo "No ESP32 serial port found."; exit 1; fi; cd bridge-firmware && idf.py -p "$PORT" erase-flash

fw-size:
    . ~/esp/esp-idf/export.sh; cd bridge-firmware && idf.py size-components

fw-ota host="192.168.4.90":
    just gen-protocol
    . ~/esp/esp-idf/export.sh; cd bridge-firmware && idf.py build
    echo "uploading bridge-firmware/build/ptlabel_bridge.bin to {{host}}"
    curl -fsS --max-time 120 --data-binary @bridge-firmware/build/ptlabel_bridge.bin -H "Content-Type: application/octet-stream" "http://{{host}}:8080/ota"
    echo

fw-logs:
    @echo "listening for UDP bridge logs on :5514 (Ctrl-C to stop)"
    nc -kul 5514

fw-usb-enable host="192.168.4.90":
    curl -fsS -X POST "http://{{host}}:8080/usb/enable"; echo

fw-reboot host="192.168.4.90":
    curl -fsS -X POST "http://{{host}}:8080/reboot"; echo

deploy-server host:
    rustup target add x86_64-unknown-linux-musl || true
    cargo install cargo-zigbuild || true
    cargo zigbuild --release -p ptlabel-server --target x86_64-unknown-linux-musl
    rsync -avz target/x86_64-unknown-linux-musl/release/ptlabel-server {{host}}:/opt/ptlabel/bin/ptlabel-server
    rsync -avz static/ {{host}}:/opt/ptlabel/static/
    rsync -avz deploy/ptlabel-server.service {{host}}:/etc/systemd/system/ptlabel-server.service
    ssh {{host}} "systemctl daemon-reload && systemctl restart ptlabel-server && systemctl status --no-pager ptlabel-server"

deploy-status host:
    ssh {{host}} "systemctl status --no-pager ptlabel-server; journalctl -u ptlabel-server -n 80 --no-pager"

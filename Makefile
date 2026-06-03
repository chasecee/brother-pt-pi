.PHONY: mac-dev mac-dev-live mac-print build deploy br-build br-flash br-rust fonts icons golden help

mac-dev:
	./scripts/dev-mac.sh

mac-dev-live:
	./scripts/dev-mac-live.sh

mac-print:
	cargo build --release -p chain-print
	target/release/chain-print --help >/dev/null

build:
	cargo build --release -p ptlabel-server

deploy:
	./deploy.sh

br-rust:
	./scripts/br-build-flash.sh --rust-only

br-build:
	./scripts/br-build-flash.sh --disk "$${DISK:?set DISK=/dev/diskN}"

br-flash:
	./scripts/br-build-flash.sh --flash-only --disk "$${DISK:?set DISK=/dev/diskN}"

fonts:
	./scripts/sync-fonts.sh

icons:
	./scripts/sync-icons.sh

golden:
	chmod +x scripts/render-golden.sh
	./scripts/render-golden.sh

help:
	@echo "mac-dev      - native Mac dev (port 5001, dev cache policy)"
	@echo "mac-dev-live - mac dev with auto-restart (cargo-watch)"
	@echo "mac-print - smoke test chain-print binary"
	@echo "build     - native release ptlabel-server (host arch)"
	@echo "deploy    - cross-build for Pi Zero W and push to running Pi"
	@echo "br-rust   - cross-build ptlabel-server only (.cache/ptlabel-server/bin/)"
	@echo "br-build  - full Buildroot image + flash (set DISK=/dev/diskN)"
	@echo "br-flash  - flash existing Buildroot image (set DISK=/dev/diskN)"
	@echo "fonts     - sync Brother fonts from P-touch Editor"
	@echo "icons     - sync icon catalog"
	@echo "golden    - render parity tests (python vs js)"

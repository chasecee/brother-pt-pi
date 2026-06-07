.PHONY: mac-dev mac-dev-live mac-print build deploy br-build br-flash br-rust boot-report fonts icons help

mac-dev:
	./scripts/dev-mac.sh

mac-dev-live:
	./scripts/dev-mac-live.sh

mac-print:
	cargo build --release -p chain-print
	target/release/chain-print --help >/dev/null

build:
	cargo build --release -p ptlabel-server

RUST_SRC := server chain-print Cargo.toml Cargo.lock
DEPLOY_STAMP := .cache/ptlabel-server/.last-deployed

deploy:
	@mkdir -p $(dir $(DEPLOY_STAMP))
	@if [ -f $(DEPLOY_STAMP) ] && [ -z "$$(find $(RUST_SRC) -newer $(DEPLOY_STAMP) -print -quit 2>/dev/null)" ]; then \
	  echo "[deploy] no rust changes since last deploy -> static-only"; \
	  ./deploy.sh $${DEVICE:+--device $$DEVICE} --static-only; \
	else \
	  echo "[deploy] rust changes since last deploy -> full deploy"; \
	  ./deploy.sh $${DEVICE:+--device $$DEVICE} && touch $(DEPLOY_STAMP); \
	fi

br-rust:
	./scripts/br-build-flash.sh --rust-only

br-build:
	./scripts/br-build-flash.sh --disk "$${DISK:?set DISK=/dev/diskN}"

br-flash:
	./scripts/br-build-flash.sh --flash-only --disk "$${DISK:?set DISK=/dev/diskN}"

boot-report:
	@if [ -n "$${DEVICE:-}" ]; then \
	  ./scripts/pi-boot-report.sh --device "$${DEVICE}"; \
	else \
	  ./scripts/pi-boot-report.sh; \
	fi

fonts:
	./scripts/sync-fonts.sh

icons:
	./scripts/sync-icons.sh

help:
	@echo "mac-dev      - native Mac dev (port 5001, dev cache policy)"
	@echo "mac-dev-live - mac dev with auto-restart (cargo-watch)"
	@echo "mac-print - smoke test chain-print binary"
	@echo "build     - native release ptlabel-server (host arch)"
	@echo "deploy    - cross-build for Pi Zero W and push to running Pi"
	@echo "br-rust   - cross-build ptlabel-server only (.cache/ptlabel-server/bin/)"
	@echo "br-build  - full Buildroot image + flash (set DISK=/dev/diskN)"
	@echo "br-flash  - flash existing Buildroot image (set DISK=/dev/diskN)"
	@echo "boot-report - print boot timing report (set DEVICE=name)"
	@echo "fonts     - sync Brother fonts from P-touch Editor"
	@echo "icons     - sync icon catalog"

.PHONY: mac-dev deploy br-build br-flash br-rust boot-report fonts icons help

mac-dev:
	./scripts/dev-mac.sh

deploy:
	./deploy.sh $${DEVICE:+--device $$DEVICE} $${STATIC_ONLY:+--static-only}

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
	@echo "deploy       - deploy app + bridge when relevant code changed (DEVICE=lxc|bridge for one)"
	@echo "br-rust      - cross-build ptlabel-bridge only (.cache/ptlabel-bridge/bin/)"
	@echo "br-build     - full Buildroot image + flash (set DISK=/dev/diskN)"
	@echo "br-flash     - flash existing Buildroot image (set DISK=/dev/diskN)"
	@echo "boot-report  - print boot timing report (set DEVICE=name)"
	@echo "fonts        - sync Brother fonts from P-touch Editor"
	@echo "icons        - sync icon catalog"

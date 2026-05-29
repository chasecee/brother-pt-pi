.PHONY: mac-dev mac-print fonts icons build push help

mac-dev:
	./scripts/dev-mac.sh

mac-print:
	cargo build --release -p chain-print
	target/release/chain-print --help >/dev/null

build:
	cargo build --release -p ptlabel-server

fonts:
	./scripts/sync-fonts.sh

icons:
	./scripts/sync-icons.sh

golden:
	chmod +x scripts/render-golden.sh
	./scripts/render-golden.sh

help:
	@echo "mac-dev   - native Mac dev (port 5001)"
	@echo "mac-print - smoke test chain-print binary"
	@echo "build     - release ptlabel-server"
	@echo "fonts     - sync Brother fonts from P-touch Editor"
	@echo "icons     - sync icon catalog"
	@echo "golden    - render parity tests (python vs js)"

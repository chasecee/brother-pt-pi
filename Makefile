IMAGE := ghcr.io/chasecee/brother-pt-pi:latest

.PHONY: mac-dev mac-print fonts push help

mac-dev:
	./scripts/dev-mac.sh

mac-print:
	PATH="$(HOME)/.cargo/bin:$$PATH" cargo build --release --manifest-path chain-print/Cargo.toml
	chain-print/target/release/chain-print --help >/dev/null

fonts:
	./scripts/sync-fonts.sh

push: fonts
	docker buildx build --platform linux/arm64 -t $(IMAGE) --push .

help:
	@echo "mac-dev   - native Mac dev with USB (port 5001)"
	@echo "mac-print - smoke test chain-print binary"
	@echo "fonts     - sync Brother fonts from P-touch Editor"
	@echo "push      - emergency: build arm64 locally and push to GHCR (CI does this on push to main)"

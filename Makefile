IMAGE := ptlabel:latest
TAR := ptlabel-arm64.tar.gz
MEDIA ?= tze18mm
BROTHER_FONTS := /Applications/P-touch Editor.app/Contents/Frameworks/BRLBXWrapperMac.framework/Versions/A/Resources/fonts.bundle

.PHONY: build run mac-dev mac-print fonts save load deploy help

build: fonts
	docker build --platform linux/arm64 -t $(IMAGE) .

run:
	docker compose up -d

mac-dev:
	./scripts/dev-mac.sh

mac-print:
	PATH="$(HOME)/.cargo/bin:$$PATH" cargo build --release --manifest-path chain-print/Cargo.toml
	chain-print/target/release/chain-print --help >/dev/null

fonts:
	./scripts/sync-fonts.sh

save:
	docker save $(IMAGE) | gzip > $(TAR)

load:
	gunzip -c $(TAR) | docker load

deploy:
	@test -n "$(HOST)" || (echo "usage: make deploy HOST=pi@raspberrypi.local" && exit 1)
	./scripts/deploy-pi.sh "$(HOST)"

help:
	@echo "build     - build arm64 Docker image for Pi 4B"
	@echo "run       - start on Pi (USB passthrough, port 5000)"
	@echo "mac-dev   - native Mac dev with USB (port 5001)"
	@echo "mac-print - smoke test chain-print binary"
	@echo "save      - export image to $(TAR)"
	@echo "load      - import image from $(TAR)"
	@echo "deploy    - bootstrap: save, scp tarball, start on Pi (HOST=pi@host)"

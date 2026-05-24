FROM rust:bookworm AS chain-builder

RUN apt-get update && apt-get install -y --no-install-recommends \
    pkg-config libusb-1.0-0-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /src
COPY chain-print/ .
RUN cargo build --release

FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 python3-venv curl \
    libusb-1.0-0 fonts-dejavu-core usbutils uhubctl \
    && rm -rf /var/lib/apt/lists/*

COPY --from=chain-builder /src/target/release/chain-print /usr/local/bin/chain-print
RUN chain-print --help >/dev/null

RUN python3 -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app.py printer.py render.py media.py storage.py .
COPY templates ./templates
COPY fonts/ ./fonts/

EXPOSE 5000

CMD ["gunicorn", "-b", "0.0.0.0:5000", "--workers", "1", "--threads", "4", "app:app"]

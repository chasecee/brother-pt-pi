import os
import shutil
import subprocess
import sys
import threading
import time
from dataclasses import dataclass
from pathlib import Path

import render as label_render
from render import RenderOpts

ROOT = Path(__file__).resolve().parent
_lock = threading.Lock()


def is_printing() -> bool:
    return _lock.locked()


@dataclass
class StatusResult:
    ok: bool
    info: str
    err: str


@dataclass
class PrintResult:
    ok: bool
    out: str
    err: str
    count: int


@dataclass
class LabelJob:
    text: str
    opts: RenderOpts


def _run(cmd: list[str], timeout: int = 120) -> subprocess.CompletedProcess[str]:
    with _lock:
        return subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)


def usb_ready() -> bool:
    try:
        if sys.platform == "darwin":
            r = subprocess.run(
                ["ioreg", "-p", "IOUSB", "-l"],
                capture_output=True,
                text=True,
                timeout=5,
            )
            return r.returncode == 0 and "PT-P710BT" in r.stdout
        r = subprocess.run(["lsusb"], capture_output=True, text=True, timeout=5)
        return r.returncode == 0 and "04f9:20af" in r.stdout.lower()
    except (OSError, subprocess.TimeoutExpired):
        return False


def _unlink(paths: list[str]) -> None:
    for p in paths:
        if p and os.path.exists(p):
            os.unlink(p)


def _chain_print_binary() -> str | None:
    custom = os.environ.get("CHAIN_PRINT", "").strip()
    if custom and os.path.isfile(custom):
        return custom
    local = ROOT / "chain-print" / "target" / "release" / "chain-print"
    if local.is_file():
        return str(local)
    return shutil.which("chain-print")


def _print_pngs(pngs: list[str]) -> PrintResult:
    binary = _chain_print_binary()
    if not binary:
        return PrintResult(
            ok=False,
            out="",
            err="chain-print not found (cd chain-print && cargo build --release)",
            count=0,
        )
    pad = os.environ.get("CHAIN_PRINT_PAD", "0")
    retries = max(1, int(os.environ.get("CHAIN_PRINT_RETRIES", "3")))
    delay = float(os.environ.get("CHAIN_PRINT_RETRY_DELAY", "1.5"))
    cmd = [binary, "--pad", pad, *pngs]
    last = PrintResult(ok=False, out="", err="print failed", count=len(pngs))
    try:
        for attempt in range(retries):
            if attempt:
                time.sleep(delay * attempt)
            r = _run(cmd)
            if r.returncode == 0:
                return PrintResult(ok=True, out=r.stdout, err="", count=len(pngs))
            err = r.stderr.strip() or r.stdout.strip() or "print failed"
            last = PrintResult(ok=False, out=r.stdout, err=err, count=len(pngs))
            if "connect" not in err.lower() and "usb" not in err.lower():
                break
        return last
    finally:
        time.sleep(0.5)


class ChainPrintBackend:
    def status(self) -> StatusResult:
        ok = usb_ready()
        return StatusResult(ok=ok, info="", err="")

    def render_png(self, text: str, opts: RenderOpts | None = None) -> str:
        return label_render.render_png(text, opts)

    def print_labels(self, labels: list[LabelJob]) -> PrintResult:
        pngs = []
        try:
            for lab in labels:
                pngs.append(label_render.render_png(lab.text, lab.opts))
            return _print_pngs(pngs)
        finally:
            _unlink(pngs)


_backend: ChainPrintBackend | None = None


def get_backend() -> ChainPrintBackend:
    global _backend
    if _backend is None:
        _backend = ChainPrintBackend()
    return _backend

import json
import os
import shutil
import subprocess
import sys
import threading
import time
from dataclasses import dataclass, field
from pathlib import Path

import media as tape_media
import render as label_render
from render import RenderOpts

ROOT = Path(__file__).resolve().parent
_lock = threading.Lock()
_media_cache: dict | None = None


def is_printing() -> bool:
    return _lock.locked()


def cached_media() -> dict | None:
    return _media_cache


@dataclass
class StatusResult:
    ok: bool
    info: str
    err: str
    media: dict | None = None


@dataclass
class MediaResult:
    ok: bool
    width_mm: int = 0
    kind: str = ""
    height_px: int = 0
    tape_color: str = ""
    text_color: str = ""
    errors: list[str] = field(default_factory=list)
    ready: bool = False
    preset: dict | None = None
    err: str = ""


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


def _usb_sysfs_reset() -> bool:
    sysfs_root = Path("/sys/bus/usb/devices")
    if not sysfs_root.is_dir():
        return False
    for dev in sysfs_root.iterdir():
        vendor_f = dev / "idVendor"
        product_f = dev / "idProduct"
        authorized_f = dev / "authorized"
        if not (vendor_f.exists() and product_f.exists() and authorized_f.exists()):
            continue
        try:
            if vendor_f.read_text().strip() == "04f9" and product_f.read_text().strip() == "20af":
                authorized_f.write_text("0\n")
                time.sleep(1.0)
                authorized_f.write_text("1\n")
                return True
        except OSError:
            continue
    return False


def _parse_status_json(raw: str) -> MediaResult:
    data = json.loads(raw)
    width = int(data.get("media_width_mm") or 0)
    preset = tape_media.preset_for_width(width) if width else None
    return MediaResult(
        ok=True,
        width_mm=width,
        kind=str(data.get("media_kind") or ""),
        height_px=int(data.get("height_px") or 0),
        tape_color=str(data.get("tape_color") or ""),
        text_color=str(data.get("text_color") or ""),
        errors=list(data.get("errors") or []),
        ready=bool(data.get("ready")),
        preset=preset,
    )


def _media_payload(result: MediaResult) -> dict:
    return {
        "ok": result.ok,
        "width_mm": result.width_mm,
        "kind": result.kind,
        "height_px": result.height_px,
        "tape_color": result.tape_color,
        "text_color": result.text_color,
        "errors": result.errors,
        "ready": result.ready,
        "preset": result.preset,
        "err": result.err,
    }


def query_media() -> MediaResult:
    global _media_cache
    binary = _chain_print_binary()
    if not binary:
        return MediaResult(ok=False, err="chain-print not found")
    try:
        with _lock:
            r = subprocess.run(
                [binary, "--status-json"],
                capture_output=True,
                text=True,
                timeout=30,
            )
        if r.returncode != 0:
            err = r.stderr.strip() or r.stdout.strip() or "status query failed"
            return MediaResult(ok=False, err=err)
        line = r.stdout.strip().splitlines()[-1]
        result = _parse_status_json(line)
        if result.ok:
            _media_cache = _media_payload(result)
        return result
    except subprocess.TimeoutExpired:
        return MediaResult(ok=False, err="status query timed out")
    except (json.JSONDecodeError, KeyError, TypeError, ValueError) as e:
        return MediaResult(ok=False, err=str(e))


def wake_printer() -> StatusResult:
    if not usb_ready():
        return StatusResult(
            ok=False,
            info="",
            err="printer not found on USB — press the power button",
        )
    _usb_sysfs_reset()
    time.sleep(2.0)
    result = query_media()
    if not result.ok:
        return StatusResult(ok=False, info="", err=result.err)
    info = f"{result.width_mm} mm"
    if result.tape_color and result.text_color:
        info += f" · {result.tape_color}/{result.text_color}"
    return StatusResult(ok=True, info=info, err="", media=_media_payload(result))


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
                if not usb_ready():
                    return PrintResult(
                        ok=False,
                        out="",
                        err="printer not found on USB — press the power button",
                        count=len(pngs),
                    )
                if "connect" in last.err.lower() or "usb" in last.err.lower():
                    wake_printer()
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


def print_labels(labels: list[LabelJob]) -> PrintResult:
    pngs = []
    try:
        for lab in labels:
            pngs.append(label_render.render_png(lab.text, lab.opts))
        return _print_pngs(pngs)
    finally:
        _unlink(pngs)

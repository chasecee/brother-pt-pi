import json
import logging
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
log = logging.getLogger("ptlabel.printer")


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
    blocks: list[dict]
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


PRINTER_VID = "04f9"
PRINTER_PID = "20af"


def _find_printer_sysfs() -> Path | None:
    root = Path("/sys/bus/usb/devices")
    if not root.is_dir():
        return None
    for dev in root.iterdir():
        v = dev / "idVendor"
        p = dev / "idProduct"
        if not (v.exists() and p.exists()):
            continue
        try:
            if v.read_text().strip() == PRINTER_VID and p.read_text().strip() == PRINTER_PID:
                return dev
        except OSError:
            continue
    return None


def _hub_chain(printer_dev: Path) -> list[str]:
    chain: list[str] = []
    cur = printer_dev.resolve().parent
    while cur.name and cur.name != "devices":
        class_f = cur / "bDeviceClass"
        if class_f.exists():
            try:
                if class_f.read_text().strip() == "09":
                    chain.append(cur.name.split("usb")[-1] if cur.name.startswith("usb") else cur.name)
            except OSError:
                pass
        cur = cur.parent
    return chain


def _all_root_hubs() -> list[str]:
    root = Path("/sys/bus/usb/devices")
    if not root.is_dir():
        return []
    return sorted(
        d.name[3:] for d in root.iterdir()
        if d.name.startswith("usb") and d.name[3:].isdigit()
    )


def _vbus_cycle(locations: list[str]) -> tuple[bool, str]:
    if not shutil.which("uhubctl"):
        log.error("vbus_cycle: uhubctl not found in PATH")
        return False, "uhubctl not installed in container"
    targets = locations or _all_root_hubs()
    if not targets:
        log.error("vbus_cycle: no USB root hubs found in sysfs")
        return False, "no USB root hubs found"
    log.info("vbus_cycle: targets=%s", targets)
    err_out = ""
    for loc in targets:
        r = subprocess.run(
            ["uhubctl", "-a", "off", "-l", loc],
            capture_output=True, text=True, timeout=10,
        )
        log.info("vbus_cycle: off -l %s rc=%d stdout=%r stderr=%r",
                 loc, r.returncode, r.stdout.strip(), r.stderr.strip())
        if r.returncode != 0:
            err_out += r.stderr
    time.sleep(2.0)
    for loc in targets:
        r = subprocess.run(
            ["uhubctl", "-a", "on", "-l", loc],
            capture_output=True, text=True, timeout=10,
        )
        log.info("vbus_cycle: on  -l %s rc=%d stdout=%r stderr=%r",
                 loc, r.returncode, r.stdout.strip(), r.stderr.strip())
        if r.returncode != 0:
            err_out += r.stderr
    return True, err_out.strip()


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
    printer_dev = _find_printer_sysfs()
    log.info("wake: printer_sysfs=%s usb_ready=%s",
             printer_dev, usb_ready())
    locations = _hub_chain(printer_dev) if printer_dev else []
    ok, err = _vbus_cycle(locations)
    if not ok:
        log.error("wake: vbus cycle failed: %s", err)
        return StatusResult(ok=False, info="", err=err or "vbus cycle failed")
    deadline = time.monotonic() + 12.0
    waited = 0.0
    while time.monotonic() < deadline:
        if usb_ready():
            log.info("wake: re-enumerated after %.1fs", waited)
            break
        time.sleep(0.5)
        waited += 0.5
    else:
        log.error("wake: printer never re-enumerated within %.1fs", waited)
        return StatusResult(
            ok=False, info="",
            err="printer did not re-enumerate after VBUS cycle — check Auto Power On is enabled in Brother's settings tool",
        )
    time.sleep(1.5)
    result = query_media()
    if not result.ok:
        log.error("wake: status query failed: %s", result.err)
        return StatusResult(ok=False, info="", err=result.err)
    info = f"{result.width_mm} mm"
    if result.tape_color and result.text_color:
        info += f" · {result.tape_color}/{result.text_color}"
    log.info("wake: ok width=%dmm tape=%s text=%s",
             result.width_mm, result.tape_color, result.text_color)
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
                log.warning("print: retry %d/%d after err=%r", attempt, retries - 1, last.err)
                if "connect" in last.err.lower() or "usb" in last.err.lower() or "index" in last.err.lower():
                    wake_printer()
                time.sleep(delay * attempt)
            r = _run(cmd)
            if r.returncode == 0:
                log.info("print: ok count=%d attempt=%d", len(pngs), attempt + 1)
                return PrintResult(ok=True, out=r.stdout, err="", count=len(pngs))
            err = r.stderr.strip() or r.stdout.strip() or "print failed"
            log.error("print: attempt=%d rc=%d err=%r", attempt + 1, r.returncode, err)
            last = PrintResult(ok=False, out=r.stdout, err=err, count=len(pngs))
            if not any(k in err.lower() for k in ("connect", "usb", "index")):
                break
        return last
    finally:
        time.sleep(0.5)


def print_labels(labels: list[LabelJob]) -> PrintResult:
    pngs = []
    try:
        for lab in labels:
            pngs.append(label_render.render_label(blocks=lab.blocks, opts=lab.opts))
        return _print_pngs(pngs)
    finally:
        _unlink(pngs)

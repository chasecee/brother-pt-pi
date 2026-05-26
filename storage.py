import json
import os
import threading
from datetime import datetime, timezone
from pathlib import Path

from blocks import blocks_have_content, migrate_draft, migrate_label_dict, normalize_blocks
from defaults import LABEL_DEFAULTS, LIMITS, prefs_defaults

QUEUE_MAX = 50
RECENT_MAX = 30

DEFAULT_PREFS = prefs_defaults()

_lock = threading.Lock()


def _data_dir() -> Path:
    raw = os.environ.get("PTLABEL_DATA_DIR", "").strip()
    if raw:
        return Path(raw)
    return Path(__file__).resolve().parent / "data"


def _state_path() -> Path:
    return _data_dir() / "state.json"


def _default_state() -> dict:
    return {
        "prefs": dict(DEFAULT_PREFS),
        "draft": {"lines": []},
        "queue": [],
        "recent": [],
    }


def _clamp_int(val, default: int, lo: int = 0, hi: int = 128) -> int:
    try:
        n = int(val)
    except (TypeError, ValueError):
        return default
    return max(lo, min(hi, n))


def _normalize_prefs(raw) -> dict:
    prefs = dict(DEFAULT_PREFS)
    if not isinstance(raw, dict):
        return prefs
    family = raw.get("fontFamily")
    if isinstance(family, str) and family.strip():
        prefs["fontFamily"] = family.strip()
    prefs["bold"] = bool(raw.get("bold", prefs["bold"]))
    prefs["italic"] = bool(raw.get("italic", prefs["italic"]))
    fs_lo, fs_hi = LIMITS["font_size"]
    va_lo, va_hi = LIMITS["v_align"]
    mh_lo, mh_hi = LIMITS["margin_h"]
    ig_lo, ig_hi = LIMITS["icon_gap"]
    is_lo, is_hi = LIMITS["icon_size"]
    prefs["fontSize"] = _clamp_int(raw.get("fontSize"), prefs["fontSize"], lo=fs_lo, hi=fs_hi)
    prefs["vAlign"] = _clamp_int(raw.get("vAlign"), prefs["vAlign"], lo=va_lo, hi=va_hi)
    try:
        prefs["letterSpacing"] = float(raw.get("letterSpacing", prefs["letterSpacing"]))
    except (TypeError, ValueError):
        pass
    prefs["marginH"] = _clamp_int(raw.get("marginH"), prefs["marginH"], lo=mh_lo, hi=mh_hi)
    prefs["iconGap"] = _clamp_int(raw.get("iconGap"), prefs["iconGap"], lo=ig_lo, hi=ig_hi)
    try:
        icon_size = float(raw.get("iconSize", prefs["iconSize"]))
    except (TypeError, ValueError):
        icon_size = prefs["iconSize"]
    prefs["iconSize"] = max(is_lo, min(is_hi, icon_size))
    return prefs


def _normalize_label(raw) -> dict | None:
    if not isinstance(raw, dict):
        return None
    blocks = migrate_label_dict(raw)
    if not blocks:
        return None
    family = (raw.get("font_family") or LABEL_DEFAULTS["font_family"]).strip() or LABEL_DEFAULTS["font_family"]
    try:
        letter_spacing = float(raw.get("letter_spacing", LABEL_DEFAULTS["letter_spacing"]))
    except (TypeError, ValueError):
        letter_spacing = float(LABEL_DEFAULTS["letter_spacing"])
    fs_lo, fs_hi = LIMITS["font_size"]
    va_lo, va_hi = LIMITS["v_align"]
    mh_lo, mh_hi = LIMITS["margin_h"]
    ig_lo, ig_hi = LIMITS["icon_gap"]
    is_lo, is_hi = LIMITS["icon_size"]
    q_lo, q_hi = LIMITS["qty"]
    try:
        icon_size = float(raw.get("icon_size", LABEL_DEFAULTS["icon_size"]))
    except (TypeError, ValueError):
        icon_size = float(LABEL_DEFAULTS["icon_size"])
    return {
        "blocks": blocks,
        "qty": _clamp_int(raw.get("qty"), 1, lo=q_lo, hi=q_hi),
        "font_size": _clamp_int(raw.get("font_size"), LABEL_DEFAULTS["font_size"], lo=fs_lo, hi=fs_hi),
        "font_family": family,
        "bold": bool(raw.get("bold", LABEL_DEFAULTS["bold"])),
        "italic": bool(raw.get("italic", LABEL_DEFAULTS["italic"])),
        "v_align": _clamp_int(raw.get("v_align"), LABEL_DEFAULTS["v_align"], lo=va_lo, hi=va_hi),
        "letter_spacing": letter_spacing,
        "margin_h": _clamp_int(raw.get("margin_h"), LABEL_DEFAULTS["margin_h"], lo=mh_lo, hi=mh_hi),
        "icon_gap": _clamp_int(raw.get("icon_gap"), LABEL_DEFAULTS["icon_gap"], lo=ig_lo, hi=ig_hi),
        "icon_size": max(is_lo, min(is_hi, icon_size)),
    }


def _normalize_queue(raw) -> list[dict]:
    if not isinstance(raw, list):
        return []
    out = []
    for item in raw[-QUEUE_MAX:]:
        label = _normalize_label(item)
        if label:
            out.append(label)
    return out


def _normalize_recent(raw) -> list[dict]:
    if not isinstance(raw, list):
        return []
    out = []
    for item in raw[:RECENT_MAX]:
        if not isinstance(item, dict):
            continue
        label = _normalize_label(item)
        if not label:
            continue
        printed_at = item.get("printed_at")
        if isinstance(printed_at, str) and printed_at.strip():
            label["printed_at"] = printed_at.strip()
        out.append(label)
    return out


def _normalize_state(raw) -> dict:
    state = _default_state()
    if not isinstance(raw, dict):
        return state
    state["prefs"] = _normalize_prefs(raw.get("prefs"))
    state["draft"] = migrate_draft(raw.get("draft"))
    state["queue"] = _normalize_queue(raw.get("queue"))
    state["recent"] = _normalize_recent(raw.get("recent"))
    return state


def _item_key(item: dict) -> str:
    payload = {
        "blocks": item.get("blocks"),
        "qty": item.get("qty", 1),
        "font_size": item.get("font_size"),
        "font_family": item.get("font_family"),
        "bold": item.get("bold"),
        "italic": item.get("italic"),
        "v_align": item.get("v_align"),
        "letter_spacing": item.get("letter_spacing"),
        "margin_h": item.get("margin_h"),
        "icon_gap": item.get("icon_gap"),
        "icon_size": item.get("icon_size"),
    }
    return json.dumps(payload, sort_keys=True, separators=(",", ":"))


def load_state() -> dict:
    path = _state_path()
    if not path.is_file():
        return _default_state()
    try:
        raw = json.loads(path.read_text())
    except (OSError, json.JSONDecodeError):
        return _default_state()
    return _normalize_state(raw)


def save_state(state: dict) -> None:
    path = _state_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    normalized = _normalize_state(state)
    tmp = path.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(normalized, indent=2) + "\n")
    os.replace(tmp, path)


def get_state() -> dict:
    with _lock:
        return load_state()


def update_state(*, prefs=None, draft=None, queue=None) -> dict:
    with _lock:
        state = load_state()
        if prefs is not None:
            state["prefs"] = _normalize_prefs(prefs)
        if draft is not None:
            state["draft"] = migrate_draft(draft)
        if queue is not None:
            state["queue"] = _normalize_queue(queue)
        save_state(state)
        return state


def record_print(items: list[dict]) -> list[dict]:
    with _lock:
        state = load_state()
        recent = list(state.get("recent") or [])
        now = datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")

        for raw in reversed(items):
            label = _normalize_label(raw)
            if not label:
                continue
            label["printed_at"] = now
            key = _item_key(label)
            recent = [item for item in recent if _item_key(item) != key]
            recent.insert(0, label)

        state["recent"] = recent[:RECENT_MAX]
        save_state(state)
        return state["recent"]

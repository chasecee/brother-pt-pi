"""Single source of truth for label defaults.

All Python modules read from LABEL_DEFAULTS. The web UI reads the same values
via render_template (see app.index). Env vars override individual fields at
process start (handy for tuning without code edits).
"""
import os


def _env_int(name: str, default: int) -> int:
    raw = os.environ.get(name, "").strip()
    if not raw:
        return default
    try:
        return int(raw)
    except ValueError:
        return default


def _env_float(name: str, default: float) -> float:
    raw = os.environ.get(name, "").strip()
    if not raw:
        return default
    try:
        return float(raw)
    except ValueError:
        return default


LABEL_DEFAULTS: dict = {
    "font_family": (os.environ.get("LABEL_FONT_FAMILY", "").strip() or "Helsinki"),
    "font_size": _env_int("LABEL_FONT_SIZE", 76),
    "bold": True,
    "italic": False,
    "v_align": _env_int("LABEL_V_ALIGN", 0),
    "letter_spacing": _env_float("LABEL_LETTER_SPACING", -0.5),
    "margin_h": _env_int("LABEL_PAD_PX", 24),
    "icon_gap": _env_int("LABEL_ICON_GAP", 4),
    "icon_size": _env_float("LABEL_ICON_SIZE", 1.0),
}

LIMITS: dict = {
    "font_size": (10, 128),
    "v_align": (-32, 32),
    "margin_h": (0, 128),
    "icon_gap": (0, 64),
    "icon_size": (0.25, 2.0),
    "qty": (1, 99),
}

_SNAKE_TO_CAMEL = {
    "font_family": "fontFamily",
    "font_size": "fontSize",
    "v_align": "vAlign",
    "letter_spacing": "letterSpacing",
    "margin_h": "marginH",
    "icon_gap": "iconGap",
    "icon_size": "iconSize",
    "bold": "bold",
    "italic": "italic",
}


def prefs_defaults() -> dict:
    """camelCase mirror used by the UI / state.json."""
    return {_SNAKE_TO_CAMEL[k]: v for k, v in LABEL_DEFAULTS.items()}

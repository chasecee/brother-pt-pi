import os

BASELINE_MM = 18
BASELINE_HEIGHT_PX = 112
BASELINE = {"font_size": 74, "margin_h": 24, "v_align": 5}

HEIGHT_PX = {6: 32, 9: 50, 12: 70, 18: 112, 24: 128}


def preset_for_width(mm: int) -> dict:
    h = HEIGHT_PX.get(mm)
    if h is None:
        h = BASELINE_HEIGHT_PX
        mm = BASELINE_MM
    s = h / BASELINE_HEIGHT_PX
    return {
        "width_mm": mm,
        "height_px": h,
        "font_size": round(BASELINE["font_size"] * s),
        "margin_h": round(BASELINE["margin_h"] * s),
        "v_align": round(BASELINE["v_align"] * s),
    }


def default_margin_h() -> int:
    px = os.environ.get("LABEL_PAD_PX", "").strip()
    if px.isdigit() and int(px) >= 0:
        return int(px)
    return BASELINE["margin_h"]

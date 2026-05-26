import base64
import logging
import os

from flask import Flask, jsonify, render_template, request, send_from_directory

logging.basicConfig(
    level=os.environ.get("PTLABEL_LOG_LEVEL", "INFO"),
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)
log = logging.getLogger("ptlabel.app")

import media as tape_media
from defaults import LABEL_DEFAULTS, LIMITS, prefs_defaults
from printer import LabelJob, is_printing, print_labels, query_media, usb_ready, wake_printer
from render import (
    FONTS_DIR,
    RenderOpts,
    effective_tape_height,
    list_fonts,
    load_preview_index,
    render_png,
    tape_height_mm,
)
from storage import get_state, record_print, update_state

app = Flask(__name__)


def _clamp_int(val, default: int, lo: int = 0, hi: int = 128) -> int:
    try:
        n = int(val)
    except (TypeError, ValueError):
        return default
    return max(lo, min(hi, n))


def _coerce_float(val, default: float) -> float:
    try:
        return float(val)
    except (TypeError, ValueError):
        return default


def parse_opts(data: dict) -> RenderOpts:
    fs_lo, fs_hi = LIMITS["font_size"]
    va_lo, va_hi = LIMITS["v_align"]
    mh_lo, mh_hi = LIMITS["margin_h"]
    family = (data.get("font_family") or LABEL_DEFAULTS["font_family"]).strip() or LABEL_DEFAULTS["font_family"]
    return RenderOpts(
        font_size=_clamp_int(data.get("font_size"), LABEL_DEFAULTS["font_size"], lo=fs_lo, hi=fs_hi),
        font_family=family,
        bold=bool(data.get("bold", LABEL_DEFAULTS["bold"])),
        italic=bool(data.get("italic", LABEL_DEFAULTS["italic"])),
        v_align=_clamp_int(data.get("v_align"), LABEL_DEFAULTS["v_align"], lo=va_lo, hi=va_hi),
        letter_spacing=_coerce_float(data.get("letter_spacing"), LABEL_DEFAULTS["letter_spacing"]),
        margin_h=_clamp_int(data.get("margin_h"), LABEL_DEFAULTS["margin_h"], lo=mh_lo, hi=mh_hi),
    )


def parse_label(data: dict) -> LabelJob | None:
    text = (data.get("text") or "").strip()
    if not text:
        return None
    return LabelJob(text=text, opts=parse_opts(data))


def expand_labels(items) -> list[LabelJob]:
    jobs: list[LabelJob] = []
    for item in items:
        if not isinstance(item, dict):
            continue
        job = parse_label(item)
        if not job:
            continue
        q_lo, q_hi = LIMITS["qty"]
        qty = _clamp_int(item.get("qty"), 1, lo=q_lo, hi=q_hi)
        jobs.extend([job] * qty)
    return jobs


def _media_response(result):
    return jsonify(
        ok=result.ok,
        width_mm=result.width_mm,
        kind=result.kind,
        height_px=result.height_px,
        tape_color=result.tape_color,
        text_color=result.text_color,
        errors=result.errors,
        ready=result.ready,
        preset=result.preset,
        err=result.err,
    )


@app.route("/")
def index():
    return render_template(
        "index.html",
        tape_height_mm=tape_height_mm(),
        prefs=prefs_defaults(),
        limits=LIMITS,
    )


@app.route("/font-previews/<path:filename>")
def font_previews(filename):
    return send_from_directory(FONTS_DIR / "previews", filename, max_age=31536000)


@app.route("/api/fonts")
def fonts():
    catalog = list_fonts()
    previews = load_preview_index()
    families = []
    for name in sorted(catalog):
        variants = catalog[name]
        meta = previews.get(name) or {}
        families.append({
            "name": name,
            "variants": sorted(variants.keys()),
            "slug": meta.get("slug"),
        })
    return jsonify(families=families)


@app.route("/api/state")
def state_get():
    return jsonify(get_state())


@app.route("/api/state", methods=["PUT"])
def state_put():
    data = request.json or {}
    fields = {}
    if "prefs" in data:
        fields["prefs"] = data["prefs"]
    if "draft" in data:
        fields["draft"] = data["draft"]
    if "queue" in data:
        fields["queue"] = data["queue"]
    if not fields:
        return jsonify(ok=False, err="no fields"), 400
    try:
        return jsonify(update_state(**fields))
    except Exception as e:
        return jsonify(ok=False, err=str(e)), 500


@app.route("/api/status")
def status():
    printing = is_printing()
    connected = usb_ready()
    return jsonify(ok=connected, printing=printing, info="", err="")


@app.route("/api/media")
def media():
    if is_printing():
        return jsonify(ok=False, err="printing"), 409
    result = query_media()
    if not result.ok:
        return _media_response(result), 500
    return _media_response(result)


@app.route("/api/preview", methods=["POST"])
def preview():
    data = request.json or {}
    text = (data.get("text") or "").strip()
    if not text:
        return jsonify(ok=False, err="empty"), 400
    opts = parse_opts(data)
    try:
        path = render_png(text, opts, tape_h=effective_tape_height())
    except Exception as e:
        return jsonify(ok=False, err=str(e)), 500
    try:
        with open(path, "rb") as fh:
            b64 = base64.b64encode(fh.read()).decode()
        return jsonify(ok=True, png="data:image/png;base64," + b64)
    finally:
        os.unlink(path)


@app.route("/api/wake", methods=["POST"])
def do_wake():
    if is_printing():
        return jsonify(ok=False, err="printing"), 409
    log.info("wake: request from %s", request.remote_addr)
    try:
        r = wake_printer()
        if not r.ok:
            log.error("wake: failed err=%r", r.err)
            return jsonify(ok=False, err=r.err), 500
        log.info("wake: success info=%r", r.info)
        return jsonify(ok=True, info=r.info, media=r.media)
    except Exception as e:
        log.exception("wake: crashed")
        return jsonify(ok=False, err=str(e)), 500


@app.route("/api/print", methods=["POST"])
def do_print():
    data = request.json or {}
    raw_labels = data.get("labels", [])
    labels = expand_labels(raw_labels)
    if not labels:
        return jsonify(ok=False, err="no labels"), 400
    try:
        r = print_labels(labels)
        if not r.ok:
            return jsonify(ok=False, err=r.err), 500
        recent = record_print(raw_labels)
        return jsonify(ok=True, out=r.out, count=r.count, recent=recent)
    except Exception as e:
        return jsonify(ok=False, err=str(e)), 500


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000)

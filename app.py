import base64
import os

from flask import Flask, jsonify, render_template, request

import media as tape_media
from printer import LabelJob, is_printing, print_labels, query_media, usb_ready, wake_printer
from render import RenderOpts, effective_tape_height, list_fonts, render_png, tape_height_mm
from storage import get_state, record_print, update_state

app = Flask(__name__)


def _clamp_int(val, default: int, lo: int = 0, hi: int = 128) -> int:
    try:
        n = int(val)
    except (TypeError, ValueError):
        return default
    return max(lo, min(hi, n))


def parse_opts(data: dict) -> RenderOpts:
    bold = bool(data.get("bold", True))
    italic = bool(data.get("italic", False))

    font_size = data.get("font_size")
    if font_size is not None:
        try:
            font_size = int(font_size)
        except (TypeError, ValueError):
            font_size = 74
    else:
        font_size = 74

    font_family = (data.get("font_family") or "Helsinki").strip() or "Helsinki"

    v_align = data.get("v_align", 5)
    try:
        v_align = int(v_align)
    except (TypeError, ValueError):
        v_align = 5

    letter_spacing = data.get("letter_spacing", -1)
    try:
        letter_spacing = float(letter_spacing)
    except (TypeError, ValueError):
        letter_spacing = -1.0

    margin_h = _clamp_int(data.get("margin_h"), tape_media.default_margin_h())

    return RenderOpts(
        font_size=font_size,
        font_family=font_family,
        bold=bold,
        italic=italic,
        v_align=v_align,
        letter_spacing=letter_spacing,
        margin_h=margin_h,
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
        qty = _clamp_int(item.get("qty"), 1, lo=1, hi=99)
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
    return render_template("index.html", tape_height_mm=tape_height_mm())


@app.route("/api/fonts")
def fonts():
    catalog = list_fonts()
    families = []
    for name in sorted(catalog):
        variants = catalog[name]
        families.append({
            "name": name,
            "variants": sorted(variants.keys()),
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
    try:
        r = wake_printer()
        if not r.ok:
            return jsonify(ok=False, err=r.err), 500
        return jsonify(ok=True, info=r.info, media=r.media)
    except Exception as e:
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

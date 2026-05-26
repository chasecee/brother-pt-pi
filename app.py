import base64
import io
import logging
import os
import uuid

from flask import Flask, jsonify, render_template, request, send_from_directory
from PIL import Image

logging.basicConfig(
    level=os.environ.get("PTLABEL_LOG_LEVEL", "INFO"),
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)
log = logging.getLogger("ptlabel.app")

import media as tape_media
from blocks import migrate_label_dict
from defaults import LABEL_DEFAULTS, LIMITS, prefs_defaults
from icons_catalog import (
    DEFAULT_ICON_CATEGORY,
    THUMBS_DIR,
    custom_icon_path,
    custom_icons_dir,
    icons_in_category,
    list_categories,
    search_icons,
)
from printer import LabelJob, is_printing, print_labels, query_media, usb_ready, wake_printer
from render import (
    FONTS_DIR,
    RenderOpts,
    _content_bbox,
    _flatten_to_l,
    effective_tape_height,
    list_fonts,
    load_preview_index,
    render_label,
    tape_height_mm,
)
from storage import get_state, record_print, update_state

app = Flask(__name__)

CUSTOM_ICON_MAX_BYTES = 512 * 1024
CUSTOM_ICON_MAX_DIM = 512


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
    ig_lo, ig_hi = LIMITS["icon_gap"]
    is_lo, is_hi = LIMITS["icon_size"]
    family = (data.get("font_family") or LABEL_DEFAULTS["font_family"]).strip() or LABEL_DEFAULTS["font_family"]
    return RenderOpts(
        font_size=_clamp_int(data.get("font_size"), LABEL_DEFAULTS["font_size"], lo=fs_lo, hi=fs_hi),
        font_family=family,
        bold=bool(data.get("bold", LABEL_DEFAULTS["bold"])),
        italic=bool(data.get("italic", LABEL_DEFAULTS["italic"])),
        v_align=_clamp_int(data.get("v_align"), LABEL_DEFAULTS["v_align"], lo=va_lo, hi=va_hi),
        letter_spacing=_coerce_float(data.get("letter_spacing"), LABEL_DEFAULTS["letter_spacing"]),
        margin_h=_clamp_int(data.get("margin_h"), LABEL_DEFAULTS["margin_h"], lo=mh_lo, hi=mh_hi),
        icon_gap=_clamp_int(data.get("icon_gap"), LABEL_DEFAULTS["icon_gap"], lo=ig_lo, hi=ig_hi),
        icon_size=max(is_lo, min(is_hi, _coerce_float(data.get("icon_size"), LABEL_DEFAULTS["icon_size"]))),
    )


def parse_label(data: dict) -> LabelJob | None:
    blocks = migrate_label_dict(data)
    if not blocks:
        return None
    return LabelJob(blocks=blocks, opts=parse_opts(data))


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


@app.route("/icons/thumbs/<path:filename>")
def icon_thumbs(filename):
    return send_from_directory(THUMBS_DIR, filename, max_age=31536000)


@app.route("/icons/custom/<icon_uuid>")
def icon_custom(icon_uuid):
    path = custom_icon_path(f"custom:{icon_uuid}")
    if not path:
        return jsonify(ok=False, err="not found"), 404
    return send_from_directory(path.parent, path.name, max_age=3600)


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


@app.route("/api/icons/categories")
def icon_categories():
    cats = []
    for cat in list_categories():
        entry = dict(cat)
        thumb = entry.get("preview_thumb")
        if thumb:
            entry["preview_thumb_url"] = f"/icons/thumbs/{thumb}"
        cats.append(entry)
    return jsonify(categories=cats)


@app.route("/api/icons")
def icon_list():
    category = (request.args.get("category") or "").strip()
    if not category:
        return jsonify(ok=False, err="category required"), 400
    icons = icons_in_category(category)
    for item in icons:
        thumb = item.get("thumb", "")
        if thumb:
            item["thumb_url"] = f"/icons/thumbs/{thumb}"
    return jsonify(icons=icons)


@app.route("/api/icons/search")
def icon_search():
    q = (request.args.get("q") or "").strip()
    if not q:
        return jsonify(icons=[])
    icons = search_icons(q)
    for item in icons:
        thumb = item.get("thumb", "")
        if thumb:
            item["thumb_url"] = f"/icons/thumbs/{thumb}"
    return jsonify(icons=icons)


@app.route("/api/icons/custom", methods=["POST"])
def icon_custom_upload():
    file = request.files.get("file")
    if not file or not file.filename:
        return jsonify(ok=False, err="no file"), 400
    if not file.filename.lower().endswith(".png"):
        return jsonify(ok=False, err="png only"), 400
    data = file.read()
    if len(data) > CUSTOM_ICON_MAX_BYTES:
        return jsonify(ok=False, err="file too large"), 400
    try:
        im = _flatten_to_l(Image.open(io.BytesIO(data)))
    except Exception:
        return jsonify(ok=False, err="invalid png"), 400
    bbox = _content_bbox(im)
    if bbox:
        im = im.crop(bbox)
    if max(im.size) > CUSTOM_ICON_MAX_DIM:
        im.thumbnail((CUSTOM_ICON_MAX_DIM, CUSTOM_ICON_MAX_DIM), Image.Resampling.LANCZOS)
    icon_uuid = uuid.uuid4().hex
    dest_dir = custom_icons_dir()
    dest_dir.mkdir(parents=True, exist_ok=True)
    out = dest_dir / f"{icon_uuid}.png"
    im.save(out)
    icon_id = f"custom:{icon_uuid}"
    return jsonify(ok=True, id=icon_id, thumb_url=f"/icons/custom/{icon_uuid}")


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
    blocks = migrate_label_dict(data)
    text = (data.get("text") or "").strip()
    if not blocks and not text:
        return jsonify(ok=False, err="empty"), 400
    opts = parse_opts(data)
    try:
        path = render_label(
            blocks=blocks,
            text=text or None,
            opts=opts,
            tape_h=effective_tape_height(),
            for_preview=True,
        )
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

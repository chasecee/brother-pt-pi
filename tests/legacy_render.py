import json
import os
import tempfile
from dataclasses import dataclass
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

import media as tape_media
from blocks import blocks_have_content, normalize_blocks
from defaults import LABEL_DEFAULTS
from icons_catalog import custom_icon_path, get_icon

ROOT = Path(__file__).resolve().parent
FONTS_DIR = ROOT / "fonts"
CATALOG_PATH = FONTS_DIR / "catalog.json"
PREVIEWS_INDEX = FONTS_DIR / "previews" / "index.json"
FALLBACK_FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"

_catalog: dict | None = None
_preview_index: dict | None = None


@dataclass
class RenderOpts:
    font_size: int = LABEL_DEFAULTS["font_size"]
    font_family: str = LABEL_DEFAULTS["font_family"]
    bold: bool = LABEL_DEFAULTS["bold"]
    italic: bool = LABEL_DEFAULTS["italic"]
    v_align: int = LABEL_DEFAULTS["v_align"]
    letter_spacing: float = LABEL_DEFAULTS["letter_spacing"]
    margin_h: int = LABEL_DEFAULTS["margin_h"]
    icon_gap: int = LABEL_DEFAULTS["icon_gap"]
    icon_size: float = LABEL_DEFAULTS["icon_size"]


def _margin_h(opts: RenderOpts) -> int:
    return max(0, opts.margin_h)


def load_catalog() -> dict:
    global _catalog
    if _catalog is not None:
        return _catalog
    if CATALOG_PATH.is_file():
        _catalog = json.loads(CATALOG_PATH.read_text())
        return _catalog
    _catalog = {}
    return _catalog


def list_fonts() -> dict:
    return load_catalog()


def load_preview_index() -> dict:
    global _preview_index
    if _preview_index is not None:
        return _preview_index
    if PREVIEWS_INDEX.is_file():
        _preview_index = json.loads(PREVIEWS_INDEX.read_text())
    else:
        _preview_index = {}
    return _preview_index


def resolve_font_file(family: str, bold: bool, italic: bool) -> Path:
    custom = os.environ.get("LABEL_FONT", "").strip()
    if custom and os.path.isfile(custom):
        return Path(custom)

    catalog = load_catalog()
    variants = catalog.get(family) or catalog.get("Helsinki") or {}
    if bold and italic:
        keys = ("boldItalic", "bold", "italic", "regular")
    elif bold:
        keys = ("bold", "boldItalic", "regular")
    elif italic:
        keys = ("italic", "boldItalic", "regular")
    else:
        keys = ("regular", "bold", "italic", "boldItalic")

    for key in keys:
        name = variants.get(key)
        if not name:
            continue
        path = FONTS_DIR / name
        if path.is_file():
            return path

    for path in sorted(FONTS_DIR.rglob("*")):
        if path.suffix.lower() in {".ttf", ".otf"}:
            return path
    if os.path.isfile(FALLBACK_FONT):
        return Path(FALLBACK_FONT)
    raise RuntimeError("no label font found")


def tape_height_px() -> int:
    px = os.environ.get("TAPE_HEIGHT_PX", "").strip()
    if px.isdigit() and int(px) > 0:
        return int(px)
    return tape_media.BASELINE_HEIGHT_PX


def tape_height_mm() -> float:
    mm = os.environ.get("TAPE_HEIGHT_MM", "").strip()
    if mm:
        try:
            return float(mm)
        except ValueError:
            pass
    return float(tape_media.BASELINE_MM)


def effective_tape_height() -> int:
    try:
        from printer import cached_media

        cached = cached_media()
        if cached and cached.get("height_px"):
            return int(cached["height_px"])
    except ImportError:
        pass
    return tape_height_px()


def _line_height(font: ImageFont.FreeTypeFont) -> int:
    ascent, descent = font.getmetrics()
    return ascent + descent


def _line_width(line: str, font: ImageFont.FreeTypeFont, spacing: float) -> float:
    if not line:
        return 0.0
    width = sum(font.getlength(ch) for ch in line)
    if len(line) > 1:
        width += spacing * (len(line) - 1)
    return width


def _line_widths(lines: list[str], font: ImageFont.FreeTypeFont, spacing: float) -> list[int]:
    return [int(round(_line_width(line, font, spacing))) for line in lines]


def _draw_line(
    draw: ImageDraw.ImageDraw,
    x: int,
    y: int,
    line: str,
    font: ImageFont.FreeTypeFont,
    spacing: float,
    fill: int,
) -> None:
    if spacing == 0:
        draw.text((x, y), line, font=font, fill=fill, anchor="ls")
        return
    cx = float(x)
    for ch in line:
        draw.text((cx, y), ch, font=font, fill=fill, anchor="ls")
        cx += font.getlength(ch) + spacing


def _icon_scale(block: dict, opts: RenderOpts) -> float:
    raw = block.get("height")
    if raw is not None:
        try:
            h = float(raw)
            if h != 1.0:
                return max(0.25, min(2.0, h))
        except (TypeError, ValueError):
            pass
    return max(0.25, min(2.0, float(opts.icon_size or 1.0)))


def _gap_before(prev_kind: str | None, kind: str, gap: int) -> int:
    if prev_kind == "icon" and kind == "icon":
        return max(0, gap)
    return 0


def _content_bbox(im: Image.Image) -> tuple | None:
    return Image.eval(im, lambda p: 255 - p).getbbox()


def _scale_to_height(src: Image.Image, target_h: int) -> Image.Image:
    w, h = src.size
    if h == 0:
        return Image.new("L", (1, target_h), 255)
    scale = target_h / h
    nw = max(1, int(round(w * scale)))
    nh = max(1, int(round(h * scale)))
    return src.resize((nw, nh), Image.Resampling.LANCZOS)


def _flatten_to_l(im: Image.Image) -> Image.Image:
    if im.mode in ("RGBA", "LA") or (im.mode == "P" and "transparency" in im.info):
        im = im.convert("RGBA")
        bg = Image.new("RGBA", im.size, (255, 255, 255, 255))
        im = Image.alpha_composite(bg, im)
    return im.convert("L")


def _load_image_l(path: Path) -> Image.Image:
    return _flatten_to_l(Image.open(path))


def _rasterize_brother_glyph(family: str, codepoint: int, target_h: int) -> Image.Image:
    path = resolve_font_file(family, False, False)
    font = ImageFont.truetype(str(path), target_h)
    ch = chr(codepoint)
    pad = target_h
    im = Image.new("L", (pad * 2, pad * 2), 255)
    draw = ImageDraw.Draw(im)
    draw.text((pad, pad), ch, font=font, fill=0, anchor="mm")
    bbox = _content_bbox(im)
    if not bbox:
        return Image.new("L", (1, target_h), 255)
    return _scale_to_height(im.crop(bbox), target_h)


def _apply_rotate(im: Image.Image, degrees: int) -> Image.Image:
    if degrees % 360 == 0:
        return im
    return im.rotate(
        -degrees,
        expand=True,
        resample=Image.Resampling.BICUBIC,
        fillcolor=255,
    )


def _fit_box(src: Image.Image, box: int, mode: str) -> Image.Image:
    w, h = src.size
    if w < 1 or h < 1:
        return Image.new("L", (box, box), 255)
    if mode == "cover":
        scale = max(box / w, box / h)
        nw = max(1, int(round(w * scale)))
        nh = max(1, int(round(h * scale)))
        resized = src.resize((nw, nh), Image.Resampling.LANCZOS)
        left = (nw - box) // 2
        top = (nh - box) // 2
        return resized.crop((left, top, left + box, top + box))
    scale = min(box / w, box / h)
    nw = max(1, int(round(w * scale)))
    nh = max(1, int(round(h * scale)))
    out = Image.new("L", (box, box), 255)
    resized = src.resize((nw, nh), Image.Resampling.LANCZOS)
    out.paste(resized, ((box - nw) // 2, (box - nh) // 2))
    return out


def _parse_icon_fit(block: dict) -> str:
    fit = block.get("fit", "crop")
    return fit if fit in ("fit", "cover", "crop") else "crop"


def _parse_icon_rotate(block: dict) -> int:
    try:
        rotate = int(block.get("rotate", 0))
    except (TypeError, ValueError):
        return 0
    return rotate if rotate in (0, 90, 180, 270) else 0


def _process_icon(src: Image.Image, target_h: int, fit: str, rotate: int) -> Image.Image:
    if fit == "crop":
        bbox = _content_bbox(src)
        if bbox:
            src = src.crop(bbox)
    src = _apply_rotate(src, rotate)
    if fit in ("fit", "cover"):
        return _fit_box(src, target_h, fit)
    return _scale_to_height(src, target_h)


def _load_custom_icon(icon_id: str, target_h: int, fit: str, rotate: int) -> Image.Image:
    path = custom_icon_path(icon_id)
    if not path:
        raise RuntimeError(f"custom icon not found: {icon_id}")
    return _process_icon(_load_image_l(path), target_h, fit, rotate)


def _icon_image(icon_id: str, target_h: int, block: dict) -> Image.Image:
    if icon_id.startswith("custom:"):
        fit = _parse_icon_fit(block)
        rotate = _parse_icon_rotate(block)
        return _load_custom_icon(icon_id, target_h, fit, rotate)
    meta = get_icon(icon_id)
    if not meta:
        raise RuntimeError(f"unknown icon: {icon_id}")
    return _rasterize_brother_glyph(meta["family"], int(meta["codepoint"]), target_h)


def render_blocks(
    blocks: list[dict],
    opts: RenderOpts | None = None,
    tape_h: int | None = None,
    for_preview: bool = False,
) -> str:
    opts = opts or RenderOpts()
    blocks = normalize_blocks(blocks)
    if not blocks_have_content(blocks):
        raise ValueError("empty blocks")

    tape_h = tape_h if tape_h is not None else effective_tape_height()
    margin_start, margin_end = _margin_h(opts), _margin_h(opts)
    spacing = float(opts.letter_spacing or 0)
    path = resolve_font_file(opts.font_family, opts.bold, opts.italic)
    font = ImageFont.truetype(str(path), opts.font_size)
    ascent, descent = font.getmetrics()
    line_h = _line_height(font)
    icon_cap = max(8, tape_h - 4)
    icon_gap = max(0, int(opts.icon_gap or 0))

    segments: list[tuple[str, object]] = []
    for block in blocks:
        if block["type"] == "text":
            segments.append(("text", str(block.get("value", ""))))
        elif block["type"] == "icon":
            scale = _icon_scale(block, opts)
            ih = max(8, min(icon_cap, int(round(line_h * scale))))
            segments.append(("icon", _icon_image(block["id"], ih, block)))

    seg_gaps = sum(
        _gap_before(segments[i - 1][0], segments[i][0], icon_gap)
        for i in range(1, len(segments))
    )

    content_w = 0
    seg_widths: list[int] = []
    for kind, payload in segments:
        if kind == "text":
            w = int(round(_line_width(payload, font, spacing)))
        else:
            w = payload.size[0]
        seg_widths.append(w)
        content_w += w
    content_w += seg_gaps

    img_w = content_w + margin_start + margin_end
    img_h = tape_h
    block_top = (img_h - line_h) // 2 + int(opts.v_align or 0)
    baseline = block_top + ascent

    im = Image.new("L", (img_w, img_h), 255)
    draw = ImageDraw.Draw(im)
    x = margin_start + (content_w - sum(seg_widths) - seg_gaps) // 2

    for i, (kind, payload) in enumerate(segments):
        if i > 0:
            x += _gap_before(segments[i - 1][0], kind, icon_gap)
        if kind == "text":
            _draw_line(draw, x, baseline, payload, font, spacing, 0)
            x += seg_widths[i]
        else:
            icon: Image.Image = payload
            iy = baseline - ascent + (line_h - icon.size[1]) // 2
            im.paste(icon, (x, max(0, iy)))
            x += seg_widths[i]

    if not for_preview:
        im = im.convert("1", dither=Image.Dither.NONE)

    fd, out = tempfile.mkstemp(suffix=".png")
    os.close(fd)
    im.save(out)
    return out


def render_label(
    *,
    blocks: list[dict] | None = None,
    text: str | None = None,
    opts: RenderOpts | None = None,
    tape_h: int | None = None,
    for_preview: bool = False,
) -> str:
    if blocks is not None:
        normalized = normalize_blocks(blocks)
        if blocks_have_content(normalized):
            return render_blocks(normalized, opts, tape_h, for_preview=for_preview)
    if text and str(text).strip():
        return render_png(str(text), opts, tape_h)
    raise ValueError("empty label")


def render_png(text: str, opts: RenderOpts | None = None, tape_h: int | None = None) -> str:
    opts = opts or RenderOpts()
    path = resolve_font_file(opts.font_family, opts.bold, opts.italic)
    tape_h = tape_h if tape_h is not None else effective_tape_height()
    margin_start, margin_end = _margin_h(opts), _margin_h(opts)
    line_gap = int(os.environ.get("LABEL_LINE_GAP_PX", "4"))
    lines = text.split("\n") or [""]
    spacing = float(opts.letter_spacing or 0)

    size = opts.font_size
    font = ImageFont.truetype(str(path), size)
    line_h = _line_height(font)
    widths = _line_widths(lines, font, spacing)
    content_w = int(max(widths)) if widths else 0
    img_w = content_w + margin_start + margin_end
    img_h = tape_h

    block_h = len(lines) * line_h + max(0, len(lines) - 1) * line_gap
    block_top = (img_h - block_h) // 2 + int(opts.v_align or 0)
    im = Image.new("1", (img_w, img_h), 1)
    draw = ImageDraw.Draw(im)
    ascent, _ = font.getmetrics()
    for i, line in enumerate(lines):
        x = margin_start + (content_w - widths[i]) // 2
        baseline = block_top + ascent + i * (line_h + line_gap)
        _draw_line(draw, x, baseline, line, font, spacing, 0)

    fd, out = tempfile.mkstemp(suffix=".png")
    os.close(fd)
    im.save(out)
    return out

import json
import os
import tempfile
from dataclasses import dataclass
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent
FONTS_DIR = ROOT / "fonts"
CATALOG_PATH = FONTS_DIR / "catalog.json"
FALLBACK_FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"

_catalog: dict | None = None


@dataclass
class RenderOpts:
    font_size: int = 74
    font_family: str = "Helsinki"
    bold: bool = True
    italic: bool = False
    v_align: int = 5
    letter_spacing: float = -1.0
    margin_h: int = 16


def _margin_h(opts: RenderOpts) -> int:
    default = int(os.environ.get("LABEL_PAD_PX", "16"))
    if opts.margin_h is not None:
        return max(0, opts.margin_h)
    return default


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

    for path in sorted(FONTS_DIR.glob("*")):
        if path.suffix.lower() in {".ttf", ".otf"}:
            return path
    if os.path.isfile(FALLBACK_FONT):
        return Path(FALLBACK_FONT)
    raise RuntimeError("no label font found")


def tape_height_px() -> int:
    px = os.environ.get("TAPE_HEIGHT_PX", "").strip()
    if px.isdigit() and int(px) > 0:
        return int(px)
    return 112


def tape_height_mm() -> float:
    mm = os.environ.get("TAPE_HEIGHT_MM", "").strip()
    if mm:
        try:
            return float(mm)
        except ValueError:
            pass
    return 18.0


def default_font_size() -> int:
    px = os.environ.get("LABEL_FONT_SIZE", "74").strip()
    if px.isdigit() and int(px) > 0:
        return int(px)
    return 74


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


def _ink_center_offset(
    lines: list[str],
    font: ImageFont.FreeTypeFont,
    tape_h: int,
    margin_start: int,
    line_h: int,
    line_gap: int,
    block_top: int,
    spacing: float,
) -> int:
    tmp = Image.new("L", (4096, tape_h), 0)
    draw = ImageDraw.Draw(tmp)
    ascent, _ = font.getmetrics()
    for i, line in enumerate(lines):
        baseline = block_top + ascent + i * (line_h + line_gap)
        _draw_line(draw, margin_start, baseline, line, font, spacing, 255)
    ink = tmp.getbbox()
    if not ink:
        return 0
    return (tape_h - (ink[3] - ink[1])) // 2 - ink[1]


def render_png(text: str, opts: RenderOpts | None = None) -> str:
    opts = opts or RenderOpts()
    path = resolve_font_file(opts.font_family, opts.bold, opts.italic)
    tape_h = tape_height_px()
    margin_start, margin_end = _margin_h(opts), _margin_h(opts)
    line_gap = int(os.environ.get("LABEL_LINE_GAP_PX", "4"))
    lines = text.split("\n") or [""]
    spacing = float(opts.letter_spacing or 0)

    size = opts.font_size or default_font_size()
    font = ImageFont.truetype(str(path), size)
    line_h = _line_height(font)
    widths = _line_widths(lines, font, spacing)
    content_w = int(max(widths)) if widths else 0
    img_w = content_w + margin_start + margin_end
    img_h = tape_h

    block_top = _ink_center_offset(
        lines, font, img_h, margin_start, line_h, line_gap, 0, spacing
    ) + int(opts.v_align or 0)
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

#!/usr/bin/env python3
import json
import re
import shutil
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
SOURCE_DIR = ROOT / "icons" / "source" / "en"
THUMBS_DIR = ROOT / "icons" / "thumbs"
CATALOG_PATH = ROOT / "icons" / "catalog.json"
FONTS_CATALOG = ROOT / "fonts" / "catalog.json"

FONT_PATH = re.compile(r'^FONT,([^,]+),(\d+),(\d+)$')
THUMB_SIZE = 48
DRAW_SIZE = 72


def category_slug(stem: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", stem.lower()).strip("-")
    return slug or "category"


def load_font_catalog() -> dict:
    if FONTS_CATALOG.is_file():
        return json.loads(FONTS_CATALOG.read_text())
    return {}


def resolve_font_path(catalog: dict, family: str) -> Path | None:
    variants = catalog.get(family) or {}
    for key in ("regular", "bold", "italic", "boldItalic"):
        rel = variants.get(key)
        if rel:
            path = ROOT / "fonts" / rel
            if path.is_file():
                return path
    return None


def rasterize_thumb(font_path: Path, codepoint: int) -> Image.Image | None:
    font = ImageFont.truetype(str(font_path), DRAW_SIZE)
    ch = chr(codepoint)
    pad = DRAW_SIZE
    mask = Image.new("L", (pad * 2, pad * 2), 0)
    ImageDraw.Draw(mask).text((pad, pad), ch, font=font, fill=255, anchor="mm")
    bbox = mask.getbbox()
    if not bbox:
        return None
    cropped = mask.crop(bbox)
    w, h = cropped.size
    max_dim = THUMB_SIZE - 2
    scale = max_dim / max(w, h)
    nw = max(1, int(round(w * scale)))
    nh = max(1, int(round(h * scale)))
    resized = cropped.resize((nw, nh), Image.Resampling.LANCZOS)
    out = Image.new("LA", (THUMB_SIZE, THUMB_SIZE), (0, 0))
    ox = (THUMB_SIZE - nw) // 2
    oy = (THUMB_SIZE - nh) // 2
    out.paste((0, 255), (ox, oy, ox + nw, oy + nh), resized)
    return out


def parse_category(xml_path: Path) -> dict | None:
    try:
        root = ET.parse(xml_path).getroot()
    except ET.ParseError as e:
        print(f"skip {xml_path.name}: {e}", file=sys.stderr)
        return None
    title = ""
    order = 0
    entries = []
    for elem in root.iter():
        tag = elem.tag.split("}")[-1] if "}" in elem.tag else elem.tag
        if tag == "BaseData":
            name = elem.attrib.get("name")
            if name == "Title" and elem.text:
                title = elem.text.strip()
            elif name == "Order" and elem.text:
                try:
                    order = int(elem.text.strip())
                except ValueError:
                    pass
        elif tag == "FilePath":
            m = FONT_PATH.match(elem.attrib.get("name", ""))
            if m:
                family, cp, _idx = m.group(1), int(m.group(2)), int(m.group(3))
                entries.append((family, cp))
    if not entries:
        return None
    cat_id = category_slug(xml_path.stem)
    return {
        "id": cat_id,
        "title": title or xml_path.stem,
        "order": order,
        "entries": entries,
    }


def main() -> None:
    if not SOURCE_DIR.is_dir():
        print(f"source missing: {SOURCE_DIR}", file=sys.stderr)
        sys.exit(1)
    font_catalog = load_font_catalog()
    THUMBS_DIR.mkdir(parents=True, exist_ok=True)

    categories = []
    icons: dict[str, dict] = {}
    expected_thumbs: set[str] = set()
    seen_ids: set[str] = set()

    for xml_path in sorted(SOURCE_DIR.glob("*.xml")):
        parsed = parse_category(xml_path)
        if not parsed:
            continue
        cat_id = parsed["id"]
        cat_icons = []
        for family, codepoint in parsed["entries"]:
            icon_id = f"{cat_id}:{codepoint}"
            if icon_id in seen_ids:
                continue
            seen_ids.add(icon_id)
            font_path = resolve_font_path(font_catalog, family)
            if not font_path:
                print(f"skip {icon_id}: no font {family}", file=sys.stderr)
                continue
            thumb_rel = f"{cat_id}/{codepoint}.png"
            thumb_path = THUMBS_DIR / thumb_rel
            thumb_path.parent.mkdir(parents=True, exist_ok=True)
            try:
                thumb = rasterize_thumb(font_path, codepoint)
                if thumb is None:
                    print(f"skip {icon_id}: empty glyph", file=sys.stderr)
                    continue
                thumb.save(thumb_path)
            except OSError as e:
                print(f"skip {icon_id}: {e}", file=sys.stderr)
                continue
            expected_thumbs.add(thumb_rel)
            icons[icon_id] = {
                "family": family,
                "codepoint": codepoint,
                "category": cat_id,
                "thumb": thumb_rel,
            }
            cat_icons.append(icon_id)

        if cat_icons:
            preview_id = cat_icons[0]
            preview_thumb = icons[preview_id]["thumb"]
            categories.append({
                "id": cat_id,
                "title": parsed["title"],
                "order": parsed["order"],
                "count": len(cat_icons),
                "preview_id": preview_id,
                "preview_thumb": preview_thumb,
            })
            print(f"{cat_id}: {len(cat_icons)} icons")

    categories.sort(
        key=lambda c: (
            0 if c["id"] == "dp-emoji" else 1,
            c["order"],
            c["title"],
        )
    )

    for path in THUMBS_DIR.rglob("*.png"):
        rel = path.relative_to(THUMBS_DIR).as_posix()
        if rel not in expected_thumbs:
            path.unlink()

    svg_dir = ROOT / "icons" / "svg"
    if svg_dir.is_dir():
        shutil.rmtree(svg_dir)

    catalog = {"categories": categories, "icons": icons}
    CATALOG_PATH.write_text(json.dumps(catalog, indent=2) + "\n")
    print(f"wrote {CATALOG_PATH} ({len(categories)} categories, {len(icons)} icons)")


if __name__ == "__main__":
    main()

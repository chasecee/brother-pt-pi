#!/usr/bin/env python3
import json
import re
import sys
from pathlib import Path

from fontTools.subset import Options, Subsetter, save_font
from fontTools.ttLib import TTFont
from PIL import ImageFont

ROOT = Path(__file__).resolve().parent.parent
FONTS_DIR = ROOT / "fonts"
CATALOG_PATH = FONTS_DIR / "catalog.json"
PREVIEWS_DIR = FONTS_DIR / "previews"
PREVIEWS_INDEX = PREVIEWS_DIR / "index.json"

VARIANT_ORDER = ("regular", "bold", "italic", "boldItalic")

BOLD_STYLES = re.compile(
    r"bold|demi|heavy|black|medium|^\s*b\s*$|^\s*m\s*$|^\s*h\s*$",
    re.I,
)
ITALIC_STYLES = re.compile(
    r"italic|oblique|slanted",
    re.I,
)
REGULAR_STYLES = re.compile(
    r"regular|roman|book|light|normal|antique|^\s*r\s*$|^\s*sl\s*$",
    re.I,
)


def variant_from_name(filename: str, style: str) -> str | None:
    stem = Path(filename).stem.upper()
    if re.search(r"(VS|VC|BI)$", stem) or re.search(r"BOLD.?ITALIC|BOLD.?OBLIQUE", style, re.I):
        return "boldItalic"
    if re.search(r"(BS|BC|BD)$", stem) or BOLD_STYLES.search(style):
        if ITALIC_STYLES.search(style):
            return "boldItalic"
        return "bold"
    if re.search(r"(IS|IC)$", stem) or ITALIC_STYLES.search(style):
        return "italic"
    if re.search(r"(RS|RT|RC|MW|MM)$", stem) or REGULAR_STYLES.search(style):
        return "regular"
    if BOLD_STYLES.search(style):
        return "bold"
    if ITALIC_STYLES.search(style):
        return "italic"
    return "regular"


def family_slug(name: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
    return slug or "font"


def unique_slug(name: str, used: set[str]) -> str:
    base = family_slug(name)
    slug = base
    n = 2
    while slug in used:
        slug = f"{base}-{n}"
        n += 1
    used.add(slug)
    return slug


def pick_variant(variants: dict[str, str]) -> str | None:
    for key in VARIANT_ORDER:
        if key in variants:
            return key
    return next(iter(variants), None)


def supported_subset_text(font: TTFont, family: str) -> str:
    cmap = font.getBestCmap() or {}
    unique = list(dict.fromkeys(family))
    return "".join(ch for ch in unique if ord(ch) in cmap)


def write_subset(src: Path, family: str, dest: Path) -> str:
    options = Options()
    options.flavor = "woff2"
    options.desubroutinize = True
    options.no_hinting = True
    options.layout_features = []
    options.layout_scripts = []
    options.drop_tables += ["GSUB", "GPOS", "GDEF", "BASE", "JSTF"]
    font = TTFont(str(src))
    text = supported_subset_text(font, family)
    if not text:
        return ""
    subsetter = Subsetter(options=options)
    subsetter.populate(text=text)
    subsetter.subset(font)
    save_font(font, str(dest), options)
    return text


def build_catalog() -> dict:
    catalog: dict[str, dict[str, str]] = {}
    paths = sorted(p for p in FONTS_DIR.rglob("*") if p.suffix.lower() in {".ttf", ".otf"})
    for path in paths:
        if path.is_relative_to(PREVIEWS_DIR):
            continue
        try:
            font = ImageFont.truetype(str(path), 24)
            family, style = font.getname()
        except OSError as e:
            print(f"skip {path.relative_to(FONTS_DIR)}: {e}", file=sys.stderr)
            continue
        family = family.strip() or path.stem
        variant = variant_from_name(path.name, style)
        entry = catalog.setdefault(family, {})
        if variant not in entry:
            entry[variant] = path.relative_to(FONTS_DIR).as_posix()
    return dict(sorted(catalog.items()))


def build_previews(catalog: dict) -> dict:
    PREVIEWS_DIR.mkdir(parents=True, exist_ok=True)
    index: dict[str, dict] = {}
    used_slugs: set[str] = set()
    expected_files: set[str] = set()

    for family, variants in catalog.items():
        variant = pick_variant(variants)
        if not variant:
            continue
        rel = variants[variant]
        src = FONTS_DIR / rel
        if not src.is_file():
            print(f"skip preview {family}: missing {rel}", file=sys.stderr)
            continue
        slug = unique_slug(family, used_slugs)
        filename = f"{slug}.woff2"
        dest = PREVIEWS_DIR / filename
        try:
            subset = write_subset(src, family, dest)
        except Exception as e:
            print(f"skip preview {family}: {e}", file=sys.stderr)
            continue
        if not subset:
            print(f"skip preview {family}: no name glyphs in font", file=sys.stderr)
            continue
        expected_files.add(filename)
        index[family] = {"slug": slug, "file": filename, "variant": variant}
        print(f"preview {family} -> {filename}")

    for path in PREVIEWS_DIR.glob("*.woff2"):
        if path.name not in expected_files:
            path.unlink()

    PREVIEWS_INDEX.write_text(json.dumps(index, indent=2) + "\n")
    return index


def main() -> None:
    if not FONTS_DIR.is_dir():
        print(f"fonts dir missing: {FONTS_DIR}", file=sys.stderr)
        sys.exit(1)
    catalog = build_catalog()
    CATALOG_PATH.write_text(json.dumps(catalog, indent=2) + "\n")
    print(f"wrote {CATALOG_PATH} ({len(catalog)} families)")
    previews = build_previews(catalog)
    print(f"wrote {PREVIEWS_INDEX} ({len(previews)} previews)")


if __name__ == "__main__":
    main()

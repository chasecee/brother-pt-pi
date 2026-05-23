#!/usr/bin/env python3
import json
import re
import sys
from pathlib import Path

from PIL import ImageFont

ROOT = Path(__file__).resolve().parent.parent
FONTS_DIR = ROOT / "fonts"
CATALOG_PATH = FONTS_DIR / "catalog.json"

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


def build_catalog() -> dict:
    catalog: dict[str, dict[str, str]] = {}
    for path in sorted(FONTS_DIR.iterdir()):
        if path.suffix.lower() not in {".ttf", ".otf"}:
            continue
        try:
            font = ImageFont.truetype(str(path), 24)
            family, style = font.getname()
        except OSError as e:
            print(f"skip {path.name}: {e}", file=sys.stderr)
            continue
        family = family.strip() or path.stem
        variant = variant_from_name(path.name, style)
        entry = catalog.setdefault(family, {})
        if variant not in entry:
            entry[variant] = path.name
    return dict(sorted(catalog.items()))


def main() -> None:
    if not FONTS_DIR.is_dir():
        print(f"fonts dir missing: {FONTS_DIR}", file=sys.stderr)
        sys.exit(1)
    catalog = build_catalog()
    CATALOG_PATH.write_text(json.dumps(catalog, indent=2) + "\n")
    print(f"wrote {CATALOG_PATH} ({len(catalog)} families)")


if __name__ == "__main__":
    main()

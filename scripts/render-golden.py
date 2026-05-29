#!/usr/bin/env python3
"""Render golden PNG fixtures using legacy reference renderer."""
import importlib.util
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TESTS = ROOT / "tests"


def load_module(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    assert spec.loader
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


load_module("defaults", TESTS / "legacy_defaults.py")
load_module("media", TESTS / "legacy_media.py")
load_module("blocks", TESTS / "legacy_blocks.py")
load_module("icons_catalog", TESTS / "legacy_icons_catalog.py")
icons_catalog = sys.modules["icons_catalog"]
icons_catalog.ROOT = ROOT
icons_catalog.ICONS_DIR = ROOT / "icons"
icons_catalog.CATALOG_PATH = icons_catalog.ICONS_DIR / "catalog.json"
icons_catalog._catalog = None
render = load_module("render", TESTS / "legacy_render.py")
render.ROOT = ROOT
render.FONTS_DIR = ROOT / "fonts"
render.CATALOG_PATH = render.FONTS_DIR / "catalog.json"
render.PREVIEWS_INDEX = render.FONTS_DIR / "previews" / "index.json"
render._catalog = None

FIXTURES = TESTS / "render-fixtures.json"
OUT = TESTS / "golden" / "python"


def main() -> int:
    cases = json.loads(FIXTURES.read_text())
    OUT.mkdir(parents=True, exist_ok=True)
    for case in cases:
        opts = render.RenderOpts(**case["opts"])
        path = render.render_blocks(
            case["blocks"],
            opts,
            tape_h=case.get("tape_h", 112),
            for_preview=case.get("for_preview", True),
        )
        dest = OUT / f"{case['id']}.png"
        dest.write_bytes(Path(path).read_bytes())
        Path(path).unlink(missing_ok=True)
        print(f"python {case['id']} -> {dest.name}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

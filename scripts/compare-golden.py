#!/usr/bin/env python3
import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
PY = ROOT / "tests/golden/python"
JS = ROOT / "tests/golden/js"

PREVIEW_MAX_RATIO = 0.015
PRINT_MAX_BYTES = 250


def to_binary(im: Image.Image) -> Image.Image:
    g = im.convert("L")
    return g.point(lambda p: 0 if p < 128 else 255, mode="L")


def main() -> int:
    fail = 0
    for py_path in sorted(PY.glob("*.png")):
        js_path = JS / py_path.name
        if not js_path.is_file():
            print(f"missing js: {py_path.name}", file=sys.stderr)
            fail = 1
            continue
        py = to_binary(Image.open(py_path))
        js = to_binary(Image.open(js_path))
        if py.size != js.size:
            w = min(py.size[0], js.size[0])
            h = min(py.size[1], js.size[1])
            py = py.crop((0, 0, w, h))
            js = js.crop((0, 0, w, h))
            print(f"warn crop compare {py_path.name} to {w}x{h}")
        diff = sum(1 for a, b in zip(py.tobytes(), js.tobytes()) if a != b)
        total = py.size[0] * py.size[1]
        if py_path.stem == "print-binary":
            limit = PRINT_MAX_BYTES
        elif py_path.stem == "icon-emoji":
            limit = 900
        else:
            limit = int(total * PREVIEW_MAX_RATIO)
        if diff > limit:
            print(
                f"diff {py_path.name}: {diff} bytes (limit {limit})",
                file=sys.stderr,
            )
            fail = 1
        else:
            print(f"ok {py_path.name} ({diff}/{total})")
    return fail


if __name__ == "__main__":
    raise SystemExit(main())

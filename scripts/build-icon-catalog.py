#!/usr/bin/env python3
import argparse
import asyncio
import base64
import hashlib
import json
import os
import re
import shutil
import sys
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET
from io import BytesIO
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
SOURCE_DIR = ROOT / "icons" / "source" / "en"
THUMBS_DIR = ROOT / "icons" / "thumbs"
CATALOG_PATH = ROOT / "icons" / "catalog.json"
SPRITE_PATH = ROOT / "icons" / "category-sprite.png"
FONTS_CATALOG = ROOT / "fonts" / "catalog.json"
TAG_CACHE_PATH = ROOT / "icons" / "tag-cache.json"

FONT_PATH = re.compile(r"^FONT,([^,]+),(\d+),(\d+)$")
TOKEN_RE = re.compile(r"[a-z0-9]+")
THUMB_SIZE = 48
DRAW_SIZE = 72
SPRITE_CELL = 64
SPRITE_GRID = 2
SPRITE_PAD = 2
VLM_RENDER_SIZE = 128
DEFAULT_EXO_BASE = "http://127.0.0.1:52415/v1"
DEFAULT_VLM_MODEL = "mlx-community/Qwen3-VL-4B-Instruct-4bit"
STOPWORDS = {
    "a",
    "an",
    "and",
    "as",
    "at",
    "for",
    "from",
    "in",
    "into",
    "is",
    "it",
    "of",
    "on",
    "or",
    "the",
    "to",
    "with",
}
CATEGORY_ALIASES = {
    "dp-animals": ["animal", "pet", "dog", "cat", "bird", "fish", "wildlife"],
    "np-animals": ["animal", "pet", "dog", "cat", "bird", "fish", "wildlife"],
    "dp-foods": ["food", "drink", "meal", "pizza", "coffee", "kitchen"],
    "np-foods": ["food", "drink", "meal", "pizza", "coffee", "kitchen"],
    "dp-kitchen": ["food", "drink", "meal", "pizza", "coffee", "kitchen"],
    "np-kitchen": ["food", "drink", "meal", "pizza", "coffee", "kitchen"],
    "dp-music": ["music", "note", "guitar", "instrument"],
    "np-music": ["music", "note", "guitar", "instrument"],
    "dp-vehicle": ["vehicle", "car", "travel", "transport"],
    "np-vehicles": ["vehicle", "car", "travel", "transport"],
    "np-arrows": ["arrow", "left", "right", "up", "down", "direction"],
    "dp-shape": ["arrow", "left", "right", "up", "down", "direction"],
    "np-shapes": ["arrow", "left", "right", "up", "down", "direction"],
    "dp-signs": ["sign", "symbol", "currency", "warning"],
    "np-signs": ["sign", "symbol", "currency", "warning"],
    "np-e-symbols": ["electric", "lightning", "power", "bolt"],
    "np-e-appliances": ["electric", "lightning", "power", "bolt"],
    "dp-sports": ["sports", "soccer", "football", "ball", "game"],
    "np-sports": ["sports", "soccer", "football", "ball", "game"],
    "dp-seasons": ["weather", "sun", "moon", "rain", "snow", "season"],
    "np-nature": ["weather", "sun", "moon", "rain", "snow", "season"],
    "dp-astrology": ["weather", "sun", "moon", "rain", "snow", "season"],
    "np-astrology": ["weather", "sun", "moon", "rain", "snow", "season"],
    "dp-emoji": ["emoji", "smile", "face", "emotion"],
    "np-emoji": ["emoji", "smile", "face", "emotion"],
}
VLM_PROMPT = (
    "Identify the concrete object shown by this pictogram. "
    'Reply with JSON only: {"caption":"<short noun phrase>","tags":["<lowercase>","..."]}. '
    "Caption must be object-focused and 2-5 words. "
    "Tags must be 4-10 single lowercase words with nouns and close synonyms. "
    "If uncertain, make the best concrete guess. No prose."
)


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


def tokenize(text: str) -> list[str]:
    return TOKEN_RE.findall(text.lower())


def normalize_caption(text: str) -> str:
    words = [w for w in tokenize(text) if w not in STOPWORDS and len(w) > 1]
    if not words:
        return "icon"
    return " ".join(words[:6])


def normalize_tags(
    raw: list[str], caption: str, category_title: str, category_id: str
) -> list[str]:
    out: list[str] = []
    seen: set[str] = set()
    for source in raw:
        for token in tokenize(source):
            if token in STOPWORDS:
                continue
            if len(token) <= 1:
                continue
            if token in seen:
                continue
            seen.add(token)
            out.append(token)
    for token in tokenize(caption):
        if token not in STOPWORDS and len(token) > 1 and token not in seen:
            seen.add(token)
            out.append(token)
    for token in tokenize(category_title):
        if token not in STOPWORDS and len(token) > 1 and token not in seen:
            seen.add(token)
            out.append(token)
    for token in CATEGORY_ALIASES.get(category_id, []):
        if token not in seen:
            seen.add(token)
            out.append(token)
    return out[:12]


def extract_json_object(text: str) -> dict:
    decoder = json.JSONDecoder()
    for i, ch in enumerate(text):
        if ch != "{":
            continue
        try:
            obj, _ = decoder.raw_decode(text[i:])
            if isinstance(obj, dict):
                return obj
        except json.JSONDecodeError:
            continue
    raise ValueError("model output does not contain a JSON object")


def coerce_text_result(text: str) -> dict:
    words = tokenize(text)
    if not words:
        return {"caption": "icon", "tags": []}
    caption = " ".join(words[:5])
    tags = []
    seen = set()
    for w in words:
        if len(w) <= 1 or w in STOPWORDS or w in seen:
            continue
        seen.add(w)
        tags.append(w)
        if len(tags) >= 10:
            break
    return {"caption": caption, "tags": tags}


def render_vlm_png(thumb_path: Path) -> bytes:
    thumb = Image.open(thumb_path).convert("LA")
    alpha = thumb.getchannel("A")
    canvas = Image.new("RGB", (VLM_RENDER_SIZE, VLM_RENDER_SIZE), (255, 255, 255))
    max_dim = VLM_RENDER_SIZE - 16
    scale = max_dim / max(1, thumb.width, thumb.height)
    nw = max(1, int(round(thumb.width * scale)))
    nh = max(1, int(round(thumb.height * scale)))
    alpha = alpha.resize((nw, nh), Image.Resampling.LANCZOS)
    glyph = Image.new("RGB", (nw, nh), (0, 0, 0))
    ox = (VLM_RENDER_SIZE - nw) // 2
    oy = (VLM_RENDER_SIZE - nh) // 2
    canvas.paste(glyph, (ox, oy), alpha)
    buf = BytesIO()
    canvas.save(buf, format="PNG", optimize=True)
    return buf.getvalue()


def request_vlm_tags(exo_base: str, model: str, image_png: bytes) -> dict:
    image_b64 = base64.b64encode(image_png).decode("ascii")
    last_content = ""
    for attempt in range(3):
        prompt = VLM_PROMPT
        if attempt > 0:
            prompt += " Return exactly one JSON object and nothing else."
        payload = {
            "model": model,
            "temperature": 0,
            "max_tokens": 120,
            "response_format": {"type": "json_object"},
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": prompt},
                        {
                            "type": "image_url",
                            "image_url": {"url": f"data:image/png;base64,{image_b64}"},
                        },
                    ],
                }
            ],
        }
        req = urllib.request.Request(
            f"{exo_base.rstrip('/')}/chat/completions",
            data=json.dumps(payload).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=120) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        choices = data.get("choices") or []
        if not choices:
            raise ValueError("model returned no choices")
        msg = choices[0].get("message") or {}
        content = msg.get("content", "")
        if isinstance(content, list):
            parts: list[str] = []
            for item in content:
                if isinstance(item, dict) and isinstance(item.get("text"), str):
                    parts.append(item["text"])
            content = "\n".join(parts)
        if not isinstance(content, str):
            raise ValueError("unexpected content format from model")
        last_content = content
        try:
            parsed = extract_json_object(content)
            caption = normalize_caption(str(parsed.get("caption") or "icon"))
            raw_tags = parsed.get("tags")
            tags = [str(t) for t in raw_tags] if isinstance(raw_tags, list) else []
            return {"caption": caption, "tags": tags}
        except ValueError:
            if attempt == 2:
                coerced = coerce_text_result(content)
                return {
                    "caption": normalize_caption(coerced["caption"]),
                    "tags": coerced["tags"],
                }
    raise ValueError(f"model output did not stabilize to JSON: {last_content[:200]}")


def preflight_exo(exo_base: str, model: str) -> None:
    req = urllib.request.Request(f"{exo_base.rstrip('/')}/models", method="GET")
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except (urllib.error.URLError, TimeoutError) as e:
        raise SystemExit(f"exo unavailable at {exo_base}: {e}") from e
    models = data.get("data")
    if not isinstance(models, list):
        raise SystemExit(f"exo returned invalid models payload at {exo_base}")
    ids = {m.get("id") for m in models if isinstance(m, dict)}
    if model not in ids:
        raise SystemExit(f"model '{model}' not found at {exo_base}/models")


def load_tag_cache(path: Path) -> dict[str, dict]:
    if not path.is_file():
        return {}
    try:
        data = json.loads(path.read_text())
    except json.JSONDecodeError:
        return {}
    if not isinstance(data, dict):
        return {}
    out: dict[str, dict] = {}
    for key, val in data.items():
        if not isinstance(key, str) or not isinstance(val, dict):
            continue
        caption = normalize_caption(str(val.get("caption") or "icon"))
        raw_tags = val.get("tags")
        tags = [str(t) for t in raw_tags] if isinstance(raw_tags, list) else []
        out[key] = {"caption": caption, "tags": tags}
    return out


def save_tag_cache(path: Path, cache: dict[str, dict]) -> None:
    path.write_text(json.dumps(cache, indent=2, sort_keys=True) + "\n")


async def apply_vlm_tags(
    icons: dict[str, dict],
    category_titles: dict[str, str],
    exo_base: str,
    model: str,
    workers: int,
    cache: dict[str, dict],
    request_timeout_s: int,
    icon_retries: int,
) -> None:
    sem = asyncio.Semaphore(max(1, workers))
    total = len(icons)
    done = 0
    cache_hits = 0
    failures = 0

    async def run_one(icon_id: str, meta: dict) -> None:
        nonlocal done, cache_hits, failures
        thumb_path = THUMBS_DIR / meta["thumb"]
        png = render_vlm_png(thumb_path)
        key = hashlib.sha1(png).hexdigest()
        cached = cache.get(key)
        if cached:
            cache_hits += 1
            caption = normalize_caption(cached.get("caption", "icon"))
            tags = normalize_tags(
                cached.get("tags") or [],
                caption,
                category_titles.get(meta["category"], ""),
                meta["category"],
            )
            meta["caption"] = caption
            meta["tags"] = tags
            done += 1
            if done <= 20 or done % 50 == 0 or done == total:
                print(f"tagging {done}/{total} (cache {cache_hits}, failed {failures})")
            return

        tagged = None
        last_error = None
        for attempt in range(max(1, icon_retries + 1)):
            try:
                async with sem:
                    tagged = await asyncio.wait_for(
                        asyncio.to_thread(request_vlm_tags, exo_base, model, png),
                        timeout=max(10, request_timeout_s),
                    )
                break
            except Exception as e:
                last_error = e
                await asyncio.sleep(0.2 * (attempt + 1))
        if tagged is None:
            failures += 1
            caption = "icon"
            tags = normalize_tags(
                [],
                caption,
                category_titles.get(meta["category"], ""),
                meta["category"],
            )
            meta["caption"] = caption
            meta["tags"] = tags
            done += 1
            if done <= 20 or done % 5 == 0 or done == total:
                print(
                    f"tagging {done}/{total} (cache {cache_hits}, failed {failures})"
                )
            if last_error is not None and failures <= 10:
                print(f"tagging warning {icon_id}: {last_error}")
            return

        caption = normalize_caption(tagged["caption"])
        tags = normalize_tags(
            tagged["tags"],
            caption,
            category_titles.get(meta["category"], ""),
            meta["category"],
        )
        result = {"caption": caption, "tags": tags}
        cache[key] = result
        meta["caption"] = caption
        meta["tags"] = tags
        done += 1
        if done <= 20 or done % 5 == 0 or done == total:
            print(f"tagging {done}/{total} (cache {cache_hits}, failed {failures})")

    tasks = [asyncio.create_task(run_one(icon_id, meta)) for icon_id, meta in icons.items()]
    for task in asyncio.as_completed(tasks):
        await task


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--exo-base-url",
        default=os.getenv("EXO_BASE_URL", DEFAULT_EXO_BASE),
    )
    parser.add_argument(
        "--vlm-model",
        default=os.getenv("VLM_MODEL", DEFAULT_VLM_MODEL),
    )
    parser.add_argument("--tag-workers", type=int, default=8)
    parser.add_argument("--request-timeout-s", type=int, default=60)
    parser.add_argument("--icon-retries", type=int, default=2)
    parser.add_argument("--max-icons", type=int, default=0)
    parser.add_argument("--tag-cache", default=str(TAG_CACHE_PATH))
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    tag_cache_path = Path(args.tag_cache)
    if not SOURCE_DIR.is_dir():
        print(f"source missing: {SOURCE_DIR}", file=sys.stderr)
        sys.exit(1)
    preflight_exo(args.exo_base_url, args.vlm_model)
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
            preview_ids = cat_icons[: SPRITE_GRID * SPRITE_GRID]
            categories.append(
                {
                    "id": cat_id,
                    "title": parsed["title"],
                    "order": parsed["order"],
                    "count": len(cat_icons),
                    "preview_ids": preview_ids,
                }
            )
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

    category_titles = {cat["id"]: cat["title"] for cat in categories}
    tag_cache = load_tag_cache(tag_cache_path)
    if args.max_icons > 0:
        tag_subset = dict(list(icons.items())[: args.max_icons])
        print(f"max-icons={args.max_icons}: tagging {len(tag_subset)} of {len(icons)}")
    else:
        tag_subset = icons
    try:
        asyncio.run(
            apply_vlm_tags(
                icons=tag_subset,
                category_titles=category_titles,
                exo_base=args.exo_base_url,
                model=args.vlm_model,
                workers=args.tag_workers,
                cache=tag_cache,
                request_timeout_s=args.request_timeout_s,
                icon_retries=args.icon_retries,
            )
        )
    except KeyboardInterrupt:
        print("tagging interrupted by user", file=sys.stderr)
        sys.exit(130)
    save_tag_cache(tag_cache_path, tag_cache)
    print(f"wrote {tag_cache_path} ({len(tag_cache)} cached tags)")

    sprite = Image.new("LA", (SPRITE_CELL, SPRITE_CELL * len(categories)), (0, 0))
    inner = SPRITE_CELL - SPRITE_PAD * 2
    sub = (inner - SPRITE_PAD) // SPRITE_GRID
    for cat_idx, cat in enumerate(categories):
        cat["sprite_index"] = cat_idx
        ids = cat.pop("preview_ids")
        for i, icon_id in enumerate(ids):
            thumb_path = THUMBS_DIR / icons[icon_id]["thumb"]
            try:
                tile = Image.open(thumb_path).convert("LA")
            except OSError:
                continue
            tile.thumbnail((sub, sub), Image.Resampling.LANCZOS)
            col = i % SPRITE_GRID
            row = i // SPRITE_GRID
            ox = SPRITE_PAD + col * (sub + SPRITE_PAD) + (sub - tile.width) // 2
            oy = (
                cat_idx * SPRITE_CELL
                + SPRITE_PAD
                + row * (sub + SPRITE_PAD)
                + (sub - tile.height) // 2
            )
            sprite.paste(tile, (ox, oy), tile)
    sprite.save(SPRITE_PATH, optimize=True)
    print(f"wrote {SPRITE_PATH} ({sprite.size[0]}x{sprite.size[1]})")

    svg_dir = ROOT / "icons" / "svg"
    if svg_dir.is_dir():
        shutil.rmtree(svg_dir)

    catalog = {"categories": categories, "icons": icons}
    CATALOG_PATH.write_text(json.dumps(catalog, indent=2) + "\n")
    print(f"wrote {CATALOG_PATH} ({len(categories)} categories, {len(icons)} icons)")


if __name__ == "__main__":
    main()

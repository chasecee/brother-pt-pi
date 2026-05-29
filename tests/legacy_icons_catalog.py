import json
import os
import re
from pathlib import Path

DEFAULT_ICON_CATEGORY = "dp-emoji"

ROOT = Path(__file__).resolve().parent
ICONS_DIR = ROOT / "icons"
CATALOG_PATH = ICONS_DIR / "catalog.json"
THUMBS_DIR = ICONS_DIR / "thumbs"

_catalog: dict | None = None


def _data_dir() -> Path:
    raw = os.environ.get("PTLABEL_DATA_DIR", "").strip()
    if raw:
        return Path(raw)
    return ROOT / "data"


def custom_icons_dir() -> Path:
    return _data_dir() / "icons" / "custom"


def load_icon_catalog() -> dict:
    global _catalog
    if _catalog is not None:
        return _catalog
    if CATALOG_PATH.is_file():
        _catalog = json.loads(CATALOG_PATH.read_text())
    else:
        _catalog = {"categories": [], "icons": {}}
    return _catalog


def get_icon(icon_id: str) -> dict | None:
    return load_icon_catalog().get("icons", {}).get(icon_id)


def list_categories() -> list[dict]:
    cats = list(load_icon_catalog().get("categories", []))
    cats.sort(
        key=lambda c: (
            0 if c.get("id") == DEFAULT_ICON_CATEGORY else 1,
            c.get("order", 0),
            c.get("title", ""),
        )
    )
    return cats


def search_icons(query: str, limit: int = 500) -> list[dict]:
    q = query.strip().lower()
    if not q:
        return []
    tokens = [t for t in re.split(r"\s+", q) if t]
    catalog = load_icon_catalog()
    cats = {c["id"]: c for c in catalog.get("categories", [])}
    out = []
    for icon_id, meta in catalog.get("icons", {}).items():
        cat_id = meta.get("category", "")
        cat = cats.get(cat_id, {})
        title = (cat.get("title") or "").replace("_", " ").lower()
        haystack = " ".join(
            filter(
                None,
                [
                    icon_id,
                    cat_id,
                    title,
                    meta.get("family", ""),
                    meta.get("label", ""),
                ],
            )
        ).lower()
        if all(tok in haystack for tok in tokens):
            out.append(
                {
                    "id": icon_id,
                    "thumb": meta.get("thumb", ""),
                    "category": cat_id,
                    "category_title": cat.get("title", ""),
                }
            )
        if len(out) >= limit:
            break
    return out


def icons_in_category(category_id: str) -> list[dict]:
    catalog = load_icon_catalog()
    out = []
    for icon_id, meta in catalog.get("icons", {}).items():
        if meta.get("category") == category_id:
            out.append({"id": icon_id, "thumb": meta.get("thumb", "")})
    return out


def custom_icon_path(icon_id: str) -> Path | None:
    if not icon_id.startswith("custom:"):
        return None
    uuid = icon_id[7:].strip()
    if not uuid or "/" in uuid or "\\" in uuid or ".." in uuid:
        return None
    path = custom_icons_dir() / f"{uuid}.png"
    return path if path.is_file() else None

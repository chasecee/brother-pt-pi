#!/usr/bin/env python3
import argparse
import html
import json
import re
import ssl
import sys
import urllib.parse
import urllib.request
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
CATALOG_PATH = ROOT / "icons" / "catalog.json"
CASES_PATH = ROOT / "tests" / "icon-search-cases.json"
REPORT_PATH = ROOT / "out" / "icon-search-report.html"
TOKEN_RE = re.compile(r"[a-z0-9]+")


def tokenize(text: str) -> list[str]:
    return TOKEN_RE.findall((text or "").lower())


def category_aliases(category_id: str) -> list[str]:
    aliases = {
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
    return aliases.get(category_id, [])


def damerau_levenshtein(a: str, b: str) -> int:
    la = len(a)
    lb = len(b)
    if la == 0:
        return lb
    if lb == 0:
        return la
    d = [[0] * (lb + 2) for _ in range(la + 2)]
    maxdist = la + lb
    d[0][0] = maxdist
    for i in range(la + 1):
        d[i + 1][0] = maxdist
        d[i + 1][1] = i
    for j in range(lb + 1):
        d[0][j + 1] = maxdist
        d[1][j + 1] = j
    last = {}
    for i in range(1, la + 1):
        db = 0
        for j in range(1, lb + 1):
            i1 = last.get(b[j - 1], 0)
            j1 = db
            cost = 0 if a[i - 1] == b[j - 1] else 1
            if cost == 0:
                db = j
            d[i + 1][j + 1] = min(
                d[i][j] + cost,
                d[i + 1][j] + 1,
                d[i][j + 1] + 1,
                d[i1][j1] + (i - i1 - 1) + 1 + (j - j1 - 1),
            )
        last[a[i - 1]] = i
    return d[la + 1][lb + 1]


def icon_score(icon: dict, tokens: list[str]) -> int:
    tags = [str(t).lower() for t in icon.get("tags") or []]
    caption = str(icon.get("caption") or "").lower()
    category_title = str(icon.get("category_title") or "").replace("_", " ").lower()
    aliases = category_aliases(str(icon.get("category") or ""))
    tags = [tag for tag in tags if tag not in aliases]
    icon_id = str(icon.get("id") or "").lower()
    total = 0
    for token in tokens:
        token_score = 0
        for tag in tags:
            if tag == token:
                token_score = max(token_score, 10)
            elif tag.startswith(token):
                token_score = max(token_score, 6)
            elif token in tag:
                token_score = max(token_score, 3)
            elif (
                len(token) >= 4
                and len(tag) >= 4
                and abs(len(token) - len(tag)) <= 2
                and damerau_levenshtein(token, tag) <= 2
            ):
                token_score = max(token_score, 1)
        if token in aliases:
            token_score = max(token_score, 2)
        if token in caption:
            token_score = max(token_score, 4)
        if token in category_title:
            token_score = max(token_score, 1)
        if token in icon_id:
            token_score = max(token_score, 1)
        if token_score == 0:
            return 0
        total += token_score
    return total


def offline_search(catalog: dict, query: str, limit: int) -> list[dict]:
    tokens = tokenize(query)
    if not tokens:
        return []
    cats = {
        c.get("id"): {
            "title": c.get("title", ""),
            "sprite_index": int(c.get("sprite_index", 0)),
        }
        for c in catalog.get("categories", [])
    }
    scored = []
    for icon_id, meta in (catalog.get("icons") or {}).items():
        cat_id = meta.get("category", "")
        cat = cats.get(cat_id) or {"title": "", "sprite_index": 1_000_000}
        icon = {
            "id": icon_id,
            "thumb": meta.get("thumb", ""),
            "thumb_url": f"/icons/thumbs/{meta.get('thumb', '')}" if meta.get("thumb") else "",
            "category": cat_id,
            "category_title": cat["title"],
            "caption": meta.get("caption", ""),
            "tags": meta.get("tags", []),
            "codepoint": int(meta.get("codepoint", 1_000_000)),
            "sprite_index": cat["sprite_index"],
        }
        score = icon_score(icon, tokens)
        if score <= 0:
            continue
        icon["_score"] = score
        scored.append(icon)
    scored.sort(
        key=lambda x: (-x["_score"], x["sprite_index"], x["codepoint"], x["id"])
    )
    return scored[:limit]


def fetch_server_search(server: str, query: str, limit: int = 500) -> list[dict]:
    url = f"{server.rstrip('/')}/api/icons/search?q={urllib.parse.quote(query)}&limit={limit}"
    ctx = ssl._create_unverified_context() if url.startswith("https://") else None
    with urllib.request.urlopen(url, timeout=30, context=ctx) as resp:
        data = json.loads(resp.read().decode("utf-8"))
    icons = data.get("icons") or []
    return [i for i in icons if isinstance(i, dict)]


def evaluate_case(case: dict, results: list[dict], icon_meta: dict[str, dict]) -> tuple[bool, str]:
    min_results = int(case.get("min_results", 1))
    if len(results) < min_results:
        return False, f"expected at least {min_results}, got {len(results)}"

    expect_categories = set(case.get("expect_categories") or [])
    if expect_categories:
        hit = any(
            (r.get("category") in expect_categories)
            or any(
                token in str(r.get("category", "")).lower()
                for token in tokenize(" ".join(expect_categories).lower())
            )
            for r in results
        )
        if not hit:
            return False, f"no result in expected categories {sorted(expect_categories)}"

    expect_tag_any = [str(t).lower() for t in (case.get("expect_tag_any") or [])]
    if expect_tag_any:
        hit = False
        for r in results:
            meta = icon_meta.get(r.get("id", "")) or {}
            tags = {str(t).lower() for t in (meta.get("tags") or [])}
            if tags.intersection(expect_tag_any):
                hit = True
                break
        if not hit:
            return False, f"no result contains any expected tag {expect_tag_any}"

    expect_top_tag_any = [str(t).lower() for t in (case.get("expect_top_tag_any") or [])]
    if expect_top_tag_any:
        top_n = max(1, int(case.get("top_n", 3)))
        hit = False
        for r in results[:top_n]:
            meta = icon_meta.get(r.get("id", "")) or {}
            tags = {str(t).lower() for t in (meta.get("tags") or [])}
            if tags.intersection(expect_top_tag_any):
                hit = True
                break
        if not hit:
            return (
                False,
                f"none of top {top_n} results contain any expected tag {expect_top_tag_any}",
            )

    return True, "ok"


def top_with_tags(results: list[dict], icon_meta: dict[str, dict], top_n: int = 3) -> str:
    parts = []
    for r in results[:top_n]:
        icon_id = str(r.get("id", ""))
        tags = [str(t).lower() for t in (icon_meta.get(icon_id, {}).get("tags") or [])][:3]
        if tags:
            parts.append(f"{icon_id}({','.join(tags)})")
        else:
            parts.append(f"{icon_id}(-)")
    return ", ".join(parts) if parts else "(none)"


def resolve_report_thumb_src(src: str, server: str) -> str:
    if not src:
        return ""
    if src.startswith("http://") or src.startswith("https://") or src.startswith("file://"):
        return src
    if src.startswith("/") and server:
        return f"{server.rstrip('/')}{src}"
    if src.startswith("/icons/thumbs/"):
        local = (ROOT / src.lstrip("/")).resolve()
        return local.as_uri()
    return src


def write_report(rows: list[dict], server: str) -> None:
    REPORT_PATH.parent.mkdir(parents=True, exist_ok=True)
    total = len(rows)
    passed = sum(1 for r in rows if r["pass"])
    parts = [
        "<!doctype html><html><head><meta charset='utf-8'>",
        "<title>Icon Search Report</title>",
        "<style>body{font:14px system-ui,sans-serif;margin:16px} .ok{border:1px solid #1f7a1f;padding:10px;margin:10px 0} .bad{border:1px solid #9d1c1c;padding:10px;margin:10px 0} .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(68px,1fr));gap:6px} .cell{border:1px solid #ddd;padding:4px;text-align:center;font-size:10px;overflow:hidden} img{width:48px;height:48px;image-rendering:pixelated}</style>",
        "</head><body>",
        f"<h1>Icon Search Report</h1><p>{passed}/{total} passing</p>",
    ]
    for row in rows:
        cls = "ok" if row["pass"] else "bad"
        parts.append(
            f"<div class='{cls}'><h3>{html.escape(row['q'])}</h3><p>{html.escape(row['reason'])}</p><div class='grid'>"
        )
        for icon in row["results"][:20]:
            src = resolve_report_thumb_src(icon.get("thumb_url") or "", server)
            icon_id = str(icon.get("id", ""))
            cat = str(icon.get("category", ""))
            tags = [str(t).lower() for t in (row["icon_meta"].get(icon_id, {}).get("tags") or [])][:3]
            tag_text = ", ".join(tags) if tags else "-"
            parts.append(
                "<div class='cell'>"
                f"<img src='{html.escape(src)}' alt=''>"
                f"<div>{html.escape(icon_id)}</div>"
                f"<div>{html.escape(cat)}</div>"
                f"<div>{html.escape(tag_text)}</div>"
                "</div>"
            )
        parts.append("</div></div>")
    parts.append("</body></html>")
    REPORT_PATH.write_text("".join(parts))


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--server", default="")
    parser.add_argument("--offline", action="store_true")
    parser.add_argument("--catalog", default=str(CATALOG_PATH))
    parser.add_argument("--cases", default=str(CASES_PATH))
    parser.add_argument("--limit", type=int, default=500)
    args = parser.parse_args()

    catalog = json.loads(Path(args.catalog).read_text())
    cases = json.loads(Path(args.cases).read_text())
    icon_meta = catalog.get("icons") or {}
    rows = []
    failures = 0

    for case in cases:
        q = case["q"]
        if args.offline:
            results = offline_search(catalog, q, args.limit)
        elif args.server:
            results = fetch_server_search(args.server, q, args.limit)
        else:
            raise SystemExit("use --offline or --server <url>")

        ok, reason = evaluate_case(case, results, icon_meta)
        top = ", ".join(r.get("id", "") for r in results[:5]) or "(none)"
        top3 = top_with_tags(results, icon_meta, top_n=3)
        status = "PASS" if ok else "FAIL"
        print(f"{status} q={q!r} {reason} top3={top3} top5={top}")
        rows.append(
            {
                "q": q,
                "pass": ok,
                "reason": reason,
                "results": results,
                "icon_meta": icon_meta,
            }
        )
        if not ok:
            failures += 1

    write_report(rows, args.server)
    print(f"wrote {REPORT_PATH}")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())

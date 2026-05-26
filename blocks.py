def text_block(value: str) -> dict:
    return {"type": "text", "value": value}


def icon_block(icon_id: str, height: float = 1.0) -> dict:
    block = {"type": "icon", "id": icon_id}
    if height != 1.0:
        block["height"] = height
    return block


def blocks_have_content(blocks) -> bool:
    if not isinstance(blocks, list):
        return False
    for block in blocks:
        if not isinstance(block, dict):
            continue
        if block.get("type") == "text" and str(block.get("value", "")).strip():
            return True
        if block.get("type") == "icon" and block.get("id"):
            return True
    return False


def normalize_blocks(raw) -> list[dict]:
    if not isinstance(raw, list):
        return []
    out = []
    for block in raw:
        if not isinstance(block, dict):
            continue
        kind = block.get("type")
        if kind == "text":
            value = block.get("value")
            if value is None:
                continue
            out.append({"type": "text", "value": str(value)})
        elif kind == "icon":
            icon_id = block.get("id")
            if not isinstance(icon_id, str) or not icon_id.strip():
                continue
            entry = {"type": "icon", "id": icon_id.strip()}
            try:
                height = float(block.get("height", 1.0))
            except (TypeError, ValueError):
                height = 1.0
            if height != 1.0:
                entry["height"] = max(0.25, min(2.0, height))
            out.append(entry)
    return out


def blocks_from_text(text: str) -> list[dict]:
    if not text or not str(text).strip():
        return []
    return [text_block(str(text))]


def migrate_label_dict(raw: dict) -> list[dict] | None:
    if not isinstance(raw, dict):
        return None
    if "blocks" in raw:
        blocks = normalize_blocks(raw.get("blocks"))
        return blocks if blocks_have_content(blocks) else None
    text = (raw.get("text") or "").strip()
    if text:
        return blocks_from_text(text)
    return None


def migrate_draft(raw) -> dict:
    if isinstance(raw, dict) and isinstance(raw.get("lines"), list):
        lines = []
        for line in raw["lines"]:
            blocks = normalize_blocks(line)
            if blocks_have_content(blocks):
                lines.append(blocks)
        return {"lines": lines}
    if isinstance(raw, str) and raw.strip():
        lines = []
        for line in raw.split("\n"):
            line = line.strip()
            if line:
                lines.append(blocks_from_text(line))
        return {"lines": lines}
    return {"lines": []}

use serde_json::{json, Map, Value};

use crate::config::Limits;

pub fn blocks_have_content(blocks: &Value) -> bool {
    let Some(arr) = blocks.as_array() else {
        return false;
    };
    for block in arr {
        let Some(obj) = block.as_object() else {
            continue;
        };
        match obj.get("type").and_then(|v| v.as_str()) {
            Some("text") => {
                if obj
                    .get("value")
                    .and_then(|v| v.as_str())
                    .is_some_and(|s| !s.trim().is_empty())
                {
                    return true;
                }
            }
            Some("icon") => {
                if obj
                    .get("id")
                    .and_then(|v| v.as_str())
                    .is_some_and(|s| !s.is_empty())
                {
                    return true;
                }
            }
            _ => {}
        }
    }
    false
}

fn normalize_text_block(obj: &Map<String, Value>, limits: &Limits) -> Option<Value> {
    let value = obj.get("value")?.as_str().unwrap_or("").to_string();
    let mut entry = Map::new();
    entry.insert("type".into(), json!("text"));
    entry.insert("value".into(), json!(value));
    if let Some(font_family) = obj.get("font_family").and_then(|v| v.as_str()) {
        let trimmed = font_family.trim();
        if !trimmed.is_empty() {
            entry.insert("font_family".into(), json!(trimmed));
        }
    }
    if let Some(bold) = obj.get("bold").and_then(|v| v.as_bool()) {
        entry.insert("bold".into(), json!(bold));
    }
    if let Some(italic) = obj.get("italic").and_then(|v| v.as_bool()) {
        entry.insert("italic".into(), json!(italic));
    }
    if let Some(font_size) = obj.get("font_size").and_then(|v| v.as_i64()) {
        entry.insert(
            "font_size".into(),
            json!((font_size as i32).clamp(limits.font_size[0], limits.font_size[1])),
        );
    }
    if let Some(v_align) = obj.get("v_align").and_then(|v| v.as_i64()) {
        entry.insert(
            "v_align".into(),
            json!((v_align as i32).clamp(limits.v_align[0], limits.v_align[1])),
        );
    }
    if let Some(letter_spacing) = obj.get("letter_spacing").and_then(|v| v.as_f64()) {
        entry.insert("letter_spacing".into(), json!(letter_spacing));
    }
    Some(Value::Object(entry))
}

pub fn normalize_blocks(raw: &Value, limits: &Limits) -> Vec<Value> {
    let Some(arr) = raw.as_array() else {
        return vec![];
    };
    let mut out = Vec::new();
    for block in arr {
        let Some(obj) = block.as_object() else {
            continue;
        };
        match obj.get("type").and_then(|v| v.as_str()) {
            Some("text") => {
                if let Some(block) = normalize_text_block(obj, limits) {
                    out.push(block);
                }
            }
            Some("icon") => {
                let Some(icon_id) = obj.get("id").and_then(|v| v.as_str()) else {
                    continue;
                };
                let icon_id = icon_id.trim();
                if icon_id.is_empty() {
                    continue;
                }
                let mut entry = Map::new();
                entry.insert("type".into(), json!("icon"));
                entry.insert("id".into(), json!(icon_id));
                let height = obj.get("height").and_then(|v| v.as_f64()).unwrap_or(1.0);
                if (height - 1.0).abs() > f64::EPSILON {
                    entry.insert("height".into(), json!(height.clamp(0.25, 2.0)));
                }
                if icon_id.starts_with("custom:") {
                    if let Some(fit) = obj.get("fit").and_then(|v| v.as_str()) {
                        if matches!(fit, "fit" | "cover" | "crop") {
                            entry.insert("fit".into(), json!(fit));
                        }
                    }
                    if let Some(rotate) = obj.get("rotate").and_then(|v| v.as_i64()) {
                        if matches!(rotate, 0 | 90 | 180 | 270) && rotate != 0 {
                            entry.insert("rotate".into(), json!(rotate));
                        }
                    }
                }
                out.push(Value::Object(entry));
            }
            _ => {}
        }
    }
    out
}

pub fn blocks_from_text(text: &str) -> Vec<Value> {
    if text.trim().is_empty() {
        return vec![];
    }
    vec![json!({ "type": "text", "value": text })]
}

pub fn migrate_label_dict(raw: &Value, limits: &Limits) -> Option<Vec<Value>> {
    let Some(obj) = raw.as_object() else {
        return None;
    };
    if obj.contains_key("blocks") {
        let blocks = normalize_blocks(&obj["blocks"], limits);
        return if blocks_have_content(&json!(blocks)) {
            Some(blocks)
        } else {
            None
        };
    }
    if let Some(text) = obj.get("text").and_then(|v| v.as_str()) {
        let t = text.trim();
        if !t.is_empty() {
            return Some(blocks_from_text(t));
        }
    }
    None
}

pub fn migrate_draft(raw: &Value, limits: &Limits) -> Value {
    if let Some(lines) = raw.get("lines").and_then(|v| v.as_array()) {
        let mut out = Vec::new();
        for line in lines {
            let blocks = normalize_blocks(line, limits);
            if blocks_have_content(&json!(blocks)) {
                out.push(blocks);
            }
        }
        return json!({ "lines": out });
    }
    if let Some(text) = raw.as_str() {
        if !text.trim().is_empty() {
            let mut lines = Vec::new();
            for line in text.lines() {
                let t = line.trim();
                if !t.is_empty() {
                    lines.push(blocks_from_text(t));
                }
            }
            return json!({ "lines": lines });
        }
    }
    json!({ "lines": [] })
}

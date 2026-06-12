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

fn normalize_custom_crop(obj: &Map<String, Value>) -> Option<Value> {
    let crop = obj.get("crop")?.as_object()?;
    let x = crop.get("x")?.as_f64()?;
    let y = crop.get("y")?.as_f64()?;
    let w = crop.get("w")?.as_f64()?;
    let h = crop.get("h")?.as_f64()?;
    if !(x.is_finite() && y.is_finite() && w.is_finite() && h.is_finite()) {
        return None;
    }
    if w <= 0.0 || h <= 0.0 {
        return None;
    }
    if x < 0.0 || y < 0.0 {
        return None;
    }
    if x + w > 1.0 || y + h > 1.0 {
        return None;
    }
    Some(json!({ "x": x, "y": y, "w": w, "h": h }))
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
                if icon_id.starts_with("custom:") {
                    let fit = obj.get("fit").and_then(|v| v.as_str()).unwrap_or("cover");
                    let normalized_fit = match fit {
                        "fit" => Some("cover"),
                        "contain" | "cover" | "crop" => Some(fit),
                        _ => Some("cover"),
                    };
                    if let Some(value) = normalized_fit {
                        entry.insert("fit".into(), json!(value));
                    }
                    let width = obj.get("width").and_then(|v| v.as_f64()).unwrap_or(3.0);
                    entry.insert("width".into(), json!(width.max(0.1)));
                    if let Some(cover_y) = obj.get("cover_y").and_then(|v| v.as_f64()) {
                        entry.insert("cover_y".into(), json!(cover_y.clamp(0.0, 1.0)));
                    }
                    if let Some(crop) = normalize_custom_crop(obj) {
                        entry.insert("crop".into(), crop);
                    }
                    if let Some(rotate) = obj.get("rotate").and_then(|v| v.as_i64()) {
                        if matches!(rotate, 0 | 90 | 180 | 270) && rotate != 0 {
                            entry.insert("rotate".into(), json!(rotate));
                        }
                    }
                } else {
                    let height = obj.get("height").and_then(|v| v.as_f64()).unwrap_or(1.0);
                    if (height - 1.0).abs() > f64::EPSILON {
                        entry.insert("height".into(), json!(height.clamp(0.25, 2.0)));
                    }
                }
                out.push(Value::Object(entry));
            }
            _ => {}
        }
    }
    out
}

pub fn extract_label_blocks(raw: &Value, limits: &Limits) -> Option<Vec<Value>> {
    let blocks = normalize_blocks(raw.get("blocks")?, limits);
    blocks_have_content(&json!(blocks)).then_some(blocks)
}

pub fn normalize_draft(raw: &Value, limits: &Limits) -> Value {
    let lines = raw
        .get("lines")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .map(|line| normalize_blocks(line, limits))
                .filter(|blocks| blocks_have_content(&json!(blocks)))
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    json!({ "lines": lines })
}

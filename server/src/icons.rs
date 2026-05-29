use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use serde_json::{json, Value};

pub const DEFAULT_ICON_CATEGORY: &str = "dp-emoji";

static CATALOG: OnceLock<Value> = OnceLock::new();

pub fn icons_dir(root: &Path) -> PathBuf {
    root.join("icons")
}

pub fn thumbs_dir(root: &Path) -> PathBuf {
    icons_dir(root).join("thumbs")
}

pub fn custom_icons_dir(data_dir: &Path) -> PathBuf {
    data_dir.join("icons").join("custom")
}

fn load_catalog(root: &Path) -> Value {
    let path = icons_dir(root).join("catalog.json");
    if !path.is_file() {
        return json!({ "categories": [], "icons": {} });
    }
    fs::read_to_string(path)
        .ok()
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or(json!({ "categories": [], "icons": {} }))
}

pub fn catalog(root: &Path) -> &'static Value {
    CATALOG.get_or_init(|| load_catalog(root))
}

pub fn get_icon(root: &Path, icon_id: &str) -> Option<Value> {
    catalog(root)
        .get("icons")?
        .get(icon_id)
        .cloned()
}

pub fn list_categories(root: &Path) -> Vec<Value> {
    let cat = catalog(root);
    let mut cats: Vec<Value> = cat
        .get("categories")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();
    cats.sort_by(|a, b| {
        let a_id = a.get("id").and_then(|v| v.as_str()).unwrap_or("");
        let b_id = b.get("id").and_then(|v| v.as_str()).unwrap_or("");
        let a_pri = if a_id == DEFAULT_ICON_CATEGORY { 0 } else { 1 };
        let b_pri = if b_id == DEFAULT_ICON_CATEGORY { 0 } else { 1 };
        a_pri
            .cmp(&b_pri)
            .then_with(|| {
                a.get("order")
                    .and_then(|v| v.as_i64())
                    .unwrap_or(0)
                    .cmp(&b.get("order").and_then(|v| v.as_i64()).unwrap_or(0))
            })
            .then_with(|| {
                a.get("title")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .cmp(b.get("title").and_then(|v| v.as_str()).unwrap_or(""))
            })
    });
    for entry in &mut cats {
        if let Some(thumb) = entry.get("preview_thumb").and_then(|v| v.as_str()) {
            entry["preview_thumb_url"] = json!(format!("/icons/thumbs/{thumb}"));
        }
    }
    cats
}

pub fn icons_in_category(root: &Path, category_id: &str) -> Vec<Value> {
    let icons = catalog(root).get("icons").and_then(|v| v.as_object());
    let Some(icons) = icons else {
        return vec![];
    };
    let mut out = Vec::new();
    for (icon_id, meta) in icons {
        if meta.get("category").and_then(|v| v.as_str()) == Some(category_id) {
            let thumb = meta.get("thumb").and_then(|v| v.as_str()).unwrap_or("");
            let mut item = json!({ "id": icon_id, "thumb": thumb });
            if !thumb.is_empty() {
                item["thumb_url"] = json!(format!("/icons/thumbs/{thumb}"));
            }
            out.push(item);
        }
    }
    out
}

pub fn search_icons(root: &Path, query: &str, limit: usize) -> Vec<Value> {
    let q = query.trim().to_lowercase();
    if q.is_empty() {
        return vec![];
    }
    let tokens: Vec<&str> = q.split_whitespace().collect();
    let cat = catalog(root);
    let cats: HashMap<String, Value> = cat
        .get("categories")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|c| {
                    let id = c.get("id")?.as_str()?.to_string();
                    Some((id, c.clone()))
                })
                .collect()
        })
        .unwrap_or_default();
    let icons = cat.get("icons").and_then(|v| v.as_object());
    let Some(icons) = icons else {
        return vec![];
    };
    let mut out = Vec::new();
    for (icon_id, meta) in icons {
        let cat_id = meta.get("category").and_then(|v| v.as_str()).unwrap_or("");
        let cat_entry = cats.get(cat_id);
        let title = cat_entry
            .and_then(|c| c.get("title"))
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .replace('_', " ")
            .to_lowercase();
        let haystack = [
            icon_id.as_str(),
            cat_id,
            title.as_str(),
            meta.get("family").and_then(|v| v.as_str()).unwrap_or(""),
            meta.get("label").and_then(|v| v.as_str()).unwrap_or(""),
        ]
        .join(" ")
        .to_lowercase();
        if tokens.iter().all(|t| haystack.contains(t)) {
            let thumb = meta.get("thumb").and_then(|v| v.as_str()).unwrap_or("");
            let mut item = json!({
                "id": icon_id,
                "thumb": thumb,
                "category": cat_id,
                "category_title": cat_entry.and_then(|c| c.get("title")).and_then(|v| v.as_str()).unwrap_or(""),
            });
            if !thumb.is_empty() {
                item["thumb_url"] = json!(format!("/icons/thumbs/{thumb}"));
            }
            out.push(item);
            if out.len() >= limit {
                break;
            }
        }
    }
    out
}

pub fn custom_icon_path(data_dir: &Path, icon_id: &str) -> Option<PathBuf> {
    if !icon_id.starts_with("custom:") {
        return None;
    }
    let uuid = icon_id[7..].trim();
    if uuid.is_empty() || uuid.contains('/') || uuid.contains('\\') || uuid.contains("..") {
        return None;
    }
    let path = custom_icons_dir(data_dir).join(format!("{uuid}.png"));
    path.is_file().then_some(path)
}

pub fn save_custom_icon(data_dir: &Path, bytes: &[u8]) -> anyhow::Result<(String, String)> {
    use image::ImageReader;
    use std::io::Cursor;

    let img = ImageReader::new(Cursor::new(bytes))
        .with_guessed_format()?
        .decode()?;
    let mut img = img.to_luma8();
    if img.width() > crate::config::CUSTOM_ICON_MAX_DIM
        || img.height() > crate::config::CUSTOM_ICON_MAX_DIM
    {
        img = image::imageops::thumbnail(
            &img,
            crate::config::CUSTOM_ICON_MAX_DIM,
            crate::config::CUSTOM_ICON_MAX_DIM,
        );
    }
    let icon_uuid = uuid::Uuid::new_v4().simple().to_string();
    let dest_dir = custom_icons_dir(data_dir);
    fs::create_dir_all(&dest_dir)?;
    let out = dest_dir.join(format!("{icon_uuid}.png"));
    img.save(&out)?;
    let icon_id = format!("custom:{icon_uuid}");
    let thumb_url = format!("/icons/custom/{icon_uuid}");
    Ok((icon_id, thumb_url))
}

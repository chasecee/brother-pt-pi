use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use serde_json::{json, Value};
use strsim::damerau_levenshtein;

pub const CATEGORY_SPRITE_CELL_PX: u32 = 64;

static CATALOG: OnceLock<Value> = OnceLock::new();

pub fn icons_dir(root: &Path) -> PathBuf {
    root.join("icons")
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

pub fn list_categories(root: &Path) -> Value {
    let cat = catalog(root);
    let mut cats: Vec<Value> = cat
        .get("categories")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();
    cats.sort_by(|a, b| {
        let a_idx = a.get("sprite_index").and_then(|v| v.as_i64()).unwrap_or(0);
        let b_idx = b.get("sprite_index").and_then(|v| v.as_i64()).unwrap_or(0);
        a_idx.cmp(&b_idx)
    });
    json!({
        "categories": cats,
        "sprite": {
            "url": "/icons/category-sprite.png",
            "cell": CATEGORY_SPRITE_CELL_PX,
        },
    })
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

fn tokenize_query(value: &str) -> Vec<String> {
    value
        .split(|c: char| !c.is_ascii_alphanumeric())
        .filter(|s| !s.is_empty())
        .map(|s| s.to_lowercase())
        .collect()
}

fn category_aliases(category_id: &str) -> &'static [&'static str] {
    match category_id {
        "dp-animals" | "np-animals" => {
            &["animal", "pet", "dog", "cat", "bird", "fish", "wildlife"]
        }
        "dp-foods" | "np-foods" | "dp-kitchen" | "np-kitchen" => {
            &["food", "drink", "meal", "pizza", "coffee", "kitchen"]
        }
        "dp-music" | "np-music" => &["music", "note", "guitar", "instrument"],
        "dp-vehicle" | "np-vehicles" => &["vehicle", "car", "travel", "transport"],
        "np-arrows" | "dp-shape" | "np-shapes" => {
            &["arrow", "left", "right", "up", "down", "direction"]
        }
        "dp-signs" | "np-signs" => &["sign", "symbol", "currency", "warning"],
        "np-e-symbols" | "np-e-appliances" => &["electric", "lightning", "power", "bolt"],
        "dp-sports" | "np-sports" => &["sports", "soccer", "football", "ball", "game"],
        "dp-seasons" | "np-nature" | "dp-astrology" | "np-astrology" => {
            &["weather", "sun", "moon", "rain", "snow", "season"]
        }
        "dp-emoji" | "np-emoji" => &["emoji", "smile", "face", "emotion"],
        _ => &[],
    }
}

struct CatInfo {
    title: String,
    title_norm: String,
    sprite_index: i64,
}

struct ScoredIcon {
    score: i64,
    sprite_index: i64,
    codepoint: i64,
    id: String,
    item: Value,
}

pub fn search_icons(root: &Path, query: &str, limit: usize) -> Vec<Value> {
    let tokens = tokenize_query(query);
    if tokens.is_empty() {
        return vec![];
    }
    let cat = catalog(root);
    let cats: HashMap<String, CatInfo> = cat
        .get("categories")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|c| {
                    let id = c.get("id")?.as_str()?.to_string();
                    let title = c
                        .get("title")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string();
                    Some((
                        id,
                        CatInfo {
                            title_norm: title.replace('_', " ").to_lowercase(),
                            title,
                            sprite_index: c.get("sprite_index").and_then(|v| v.as_i64()).unwrap_or(0),
                        },
                    ))
                })
                .collect()
        })
        .unwrap_or_default();
    let icons = cat.get("icons").and_then(|v| v.as_object());
    let Some(icons) = icons else {
        return vec![];
    };
    let mut scored = Vec::new();
    for (icon_id, meta) in icons {
        let cat_id = meta.get("category").and_then(|v| v.as_str()).unwrap_or("");
        let cat_entry = cats.get(cat_id);
        let cat_title = cat_entry.map(|c| c.title_norm.as_str()).unwrap_or("");
        let cat_title_raw = cat_entry.map(|c| c.title.as_str()).unwrap_or("");
        let icon_id_lc = icon_id.to_lowercase();
        let caption = meta
            .get("caption")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_lowercase();
        let mut tags: Vec<String> = meta
            .get("tags")
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|v| v.as_str())
                    .map(|s| s.to_lowercase())
                    .collect()
            })
            .unwrap_or_default();
        let aliases = category_aliases(cat_id);
        tags.retain(|tag| !aliases.iter().any(|alias| *alias == tag));

        let mut total_score = 0i64;
        let mut all_tokens_matched = true;
        for token in &tokens {
            let mut token_score = 0i64;
            for tag in &tags {
                if tag == token {
                    token_score = token_score.max(10);
                } else if tag.starts_with(token) {
                    token_score = token_score.max(6);
                } else if tag.contains(token) {
                    token_score = token_score.max(3);
                } else if token.len() >= 4
                    && tag.len() >= 4
                    && token.len().abs_diff(tag.len()) <= 2
                    && damerau_levenshtein(token, tag) <= 2
                {
                    token_score = token_score.max(1);
                }
            }
            if aliases.iter().any(|alias| *alias == token) {
                token_score = token_score.max(2);
            }
            if caption.contains(token) {
                token_score = token_score.max(4);
            }
            if cat_title.contains(token) {
                token_score = token_score.max(1);
            }
            if icon_id_lc.contains(token) {
                token_score = token_score.max(1);
            }
            if token_score == 0 {
                all_tokens_matched = false;
                break;
            }
            total_score += token_score;
        }
        if !all_tokens_matched {
            continue;
        }
        let thumb = meta.get("thumb").and_then(|v| v.as_str()).unwrap_or("");
        let mut item = json!({
            "id": icon_id,
            "thumb": thumb,
            "category": cat_id,
            "category_title": cat_title_raw,
        });
        if !thumb.is_empty() {
            item["thumb_url"] = json!(format!("/icons/thumbs/{thumb}"));
        }
        scored.push(ScoredIcon {
            score: total_score,
            sprite_index: cat_entry.map(|c| c.sprite_index).unwrap_or(i64::MAX),
            codepoint: meta.get("codepoint").and_then(|v| v.as_i64()).unwrap_or(i64::MAX),
            id: icon_id.clone(),
            item,
        });
    }
    scored.sort_by(|a, b| {
        b.score
            .cmp(&a.score)
            .then_with(|| a.sprite_index.cmp(&b.sprite_index))
            .then_with(|| a.codepoint.cmp(&b.codepoint))
            .then_with(|| a.id.cmp(&b.id))
    });
    scored.into_iter().take(limit).map(|s| s.item).collect()
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

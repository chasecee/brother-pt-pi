use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use serde::Deserialize;
use serde_json::{json, Value};

#[derive(Debug, Clone, Deserialize)]
pub struct FontEntry {
    #[serde(default)]
    pub variants: HashMap<String, String>,
    #[serde(default)]
    pub metrics: HashMap<String, FontMetrics>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct FontMetrics {
    pub ascender: i32,
    pub descender: i32,
    #[serde(rename = "unitsPerEm")]
    pub units_per_em: u32,
}

static CATALOG: OnceLock<HashMap<String, FontEntry>> = OnceLock::new();
static PREVIEWS: OnceLock<HashMap<String, Value>> = OnceLock::new();

pub fn fonts_dir(root: &Path) -> PathBuf {
    root.join("fonts")
}

fn load_catalog(root: &Path) -> HashMap<String, FontEntry> {
    let path = fonts_dir(root).join("catalog.json");
    if !path.is_file() {
        return HashMap::new();
    }
    fs::read_to_string(path)
        .ok()
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or_default()
}

fn load_previews(root: &Path) -> HashMap<String, Value> {
    let path = fonts_dir(root).join("previews").join("index.json");
    if !path.is_file() {
        return HashMap::new();
    }
    fs::read_to_string(path)
        .ok()
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or_default()
}

pub fn catalog(root: &Path) -> &'static HashMap<String, FontEntry> {
    CATALOG.get_or_init(|| load_catalog(root))
}

pub fn previews(root: &Path) -> &'static HashMap<String, Value> {
    PREVIEWS.get_or_init(|| load_previews(root))
}

pub fn list_fonts(root: &Path) -> Value {
    let cat = catalog(root);
    let prev = previews(root);
    let mut names: Vec<_> = cat.keys().cloned().collect();
    names.sort();
    let families: Vec<Value> = names
        .into_iter()
        .map(|name| {
            let entry = cat.get(&name).cloned().unwrap_or(FontEntry {
                variants: HashMap::new(),
                metrics: HashMap::new(),
            });
            let mut variant_urls = serde_json::Map::new();
            for (key, filename) in &entry.variants {
                variant_urls.insert(key.clone(), json!(format!("/fonts/{filename}")));
            }
            let mut metrics = serde_json::Map::new();
            for (key, m) in &entry.metrics {
                metrics.insert(
                    key.clone(),
                    json!({
                        "ascender": m.ascender,
                        "descender": m.descender,
                        "unitsPerEm": m.units_per_em,
                    }),
                );
            }
            let meta = prev.get(&name).cloned().unwrap_or(json!({}));
            json!({
                "name": name,
                "variants": variant_urls,
                "metrics": metrics,
                "slug": meta.get("slug"),
            })
        })
        .collect();
    json!({ "families": families })
}

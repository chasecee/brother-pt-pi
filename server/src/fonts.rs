use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use anyhow::{Context, Result};
use serde_json::{json, Value};

static CATALOG: OnceLock<HashMap<String, HashMap<String, String>>> = OnceLock::new();
static PREVIEWS: OnceLock<HashMap<String, Value>> = OnceLock::new();

pub fn fonts_dir(root: &Path) -> PathBuf {
    root.join("fonts")
}

fn load_catalog(root: &Path) -> HashMap<String, HashMap<String, String>> {
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

pub fn catalog(root: &Path) -> &'static HashMap<String, HashMap<String, String>> {
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
            let variants = cat.get(&name).cloned().unwrap_or_default();
            let mut variant_urls = serde_json::Map::new();
            for (key, filename) in &variants {
                variant_urls.insert(key.clone(), json!(format!("/fonts/{filename}")));
            }
            let meta = prev.get(&name).cloned().unwrap_or(json!({}));
            json!({
                "name": name,
                "variants": variant_urls,
                "slug": meta.get("slug"),
            })
        })
        .collect();
    json!({ "families": families })
}

pub fn resolve_font_path(root: &Path, family: &str, bold: bool, italic: bool) -> Result<PathBuf> {
    let cat = catalog(root);
    let variants = cat
        .get(family)
        .or_else(|| cat.get("Helsinki"))
        .context("font family not found")?;
    let keys: &[&str] = if bold && italic {
        &["boldItalic", "bold", "italic", "regular"]
    } else if bold {
        &["bold", "boldItalic", "regular"]
    } else if italic {
        &["italic", "boldItalic", "regular"]
    } else {
        &["regular", "bold", "italic", "boldItalic"]
    };
    for key in keys {
        if let Some(name) = variants.get(*key) {
            let path = fonts_dir(root).join(name);
            if path.is_file() {
                return Ok(path);
            }
        }
    }
    anyhow::bail!("no font file for {family}")
}

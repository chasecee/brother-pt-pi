use std::fs;
use std::path::PathBuf;

use parking_lot::Mutex;
use serde_json::{json, Value};

use crate::blocks::{migrate_draft, migrate_label_dict};
use crate::config::{self, LabelDefaults, Limits, QUEUE_MAX, RECENT_MAX};

pub struct StateStore {
    data_dir: PathBuf,
    defaults: LabelDefaults,
    limits: Limits,
    lock: Mutex<()>,
}

impl StateStore {
    pub fn new(data_dir: PathBuf, defaults: LabelDefaults, limits: Limits) -> Self {
        Self {
            data_dir,
            defaults,
            limits,
            lock: Mutex::new(()),
        }
    }

    fn state_path(&self) -> PathBuf {
        self.data_dir.join("state.json")
    }

    fn default_state(&self) -> Value {
        json!({
            "prefs": self.defaults.prefs_defaults(),
            "draft": { "lines": [] },
            "queue": [],
            "recent": [],
        })
    }

    fn normalize_prefs(&self, raw: &Value) -> Value {
        let mut prefs = self.defaults.prefs_defaults();
        let Some(obj) = raw.as_object() else {
            return prefs;
        };
        if let Some(family) = obj.get("fontFamily").and_then(|v| v.as_str()) {
            let t = family.trim();
            if !t.is_empty() {
                prefs["fontFamily"] = json!(t);
            }
        }
        if let Some(v) = obj.get("bold") {
            prefs["bold"] = json!(v.as_bool().unwrap_or(true));
        }
        if let Some(v) = obj.get("italic") {
            prefs["italic"] = json!(v.as_bool().unwrap_or(false));
        }
        let lim = &self.limits;
        prefs["fontSize"] = json!(config::clamp_int(
            &obj["fontSize"],
            prefs["fontSize"].as_i64().unwrap_or(76) as i32,
            lim.font_size[0],
            lim.font_size[1],
        ));
        prefs["vAlign"] = json!(config::clamp_int(
            &obj["vAlign"],
            prefs["vAlign"].as_i64().unwrap_or(0) as i32,
            lim.v_align[0],
            lim.v_align[1],
        ));
        prefs["letterSpacing"] = json!(config::coerce_float(
            &obj["letterSpacing"],
            prefs["letterSpacing"].as_f64().unwrap_or(-0.5),
        ));
        prefs["marginH"] = json!(config::clamp_int(
            &obj["marginH"],
            prefs["marginH"].as_i64().unwrap_or(24) as i32,
            lim.margin_h[0],
            lim.margin_h[1],
        ));
        prefs["iconGap"] = json!(config::clamp_int(
            &obj["iconGap"],
            prefs["iconGap"].as_i64().unwrap_or(4) as i32,
            lim.icon_gap[0],
            lim.icon_gap[1],
        ));
        let icon_size = config::coerce_float(
            &obj["iconSize"],
            prefs["iconSize"].as_f64().unwrap_or(1.0),
        );
        prefs["iconSize"] = json!(icon_size.clamp(lim.icon_size[0], lim.icon_size[1]));
        prefs
    }

    fn normalize_label(&self, raw: &Value) -> Option<Value> {
        let blocks = migrate_label_dict(raw)?;
        let obj = raw.as_object()?;
        let d = &self.defaults;
        let lim = &self.limits;
        let family = obj
            .get("font_family")
            .and_then(|v| v.as_str())
            .map(|s| s.trim())
            .filter(|s| !s.is_empty())
            .unwrap_or(d.font_family.as_str());
        Some(json!({
            "blocks": blocks,
            "qty": config::clamp_int(&obj["qty"], 1, lim.qty[0], lim.qty[1]),
            "font_size": config::clamp_int(&obj["font_size"], d.font_size, lim.font_size[0], lim.font_size[1]),
            "font_family": family,
            "bold": obj.get("bold").and_then(|v| v.as_bool()).unwrap_or(d.bold),
            "italic": obj.get("italic").and_then(|v| v.as_bool()).unwrap_or(d.italic),
            "v_align": config::clamp_int(&obj["v_align"], d.v_align, lim.v_align[0], lim.v_align[1]),
            "letter_spacing": config::coerce_float(&obj["letter_spacing"], d.letter_spacing),
            "margin_h": config::clamp_int(&obj["margin_h"], d.margin_h, lim.margin_h[0], lim.margin_h[1]),
            "icon_gap": config::clamp_int(&obj["icon_gap"], d.icon_gap, lim.icon_gap[0], lim.icon_gap[1]),
            "icon_size": config::coerce_float(&obj["icon_size"], d.icon_size).clamp(lim.icon_size[0], lim.icon_size[1]),
        }))
    }

    fn normalize_label_from_meta(&self, meta: &Value) -> Option<Value> {
        self.normalize_label(meta)
    }

    fn normalize_queue(&self, raw: &Value) -> Vec<Value> {
        let Some(arr) = raw.as_array() else {
            return vec![];
        };
        let start = arr.len().saturating_sub(QUEUE_MAX);
        arr[start..]
            .iter()
            .filter_map(|item| self.normalize_label(item))
            .collect()
    }

    fn normalize_recent(&self, raw: &Value) -> Vec<Value> {
        let Some(arr) = raw.as_array() else {
            return vec![];
        };
        let mut out = Vec::new();
        for item in arr.iter().take(RECENT_MAX) {
            let Some(mut label) = self.normalize_label(item) else {
                continue;
            };
            if let Some(printed_at) = item.get("printed_at").and_then(|v| v.as_str()) {
                let t = printed_at.trim();
                if !t.is_empty() {
                    label["printed_at"] = json!(t);
                }
            }
            out.push(label);
        }
        out
    }

    fn normalize_state(&self, raw: &Value) -> Value {
        let mut state = self.default_state();
        let Some(obj) = raw.as_object() else {
            return state;
        };
        state["prefs"] = self.normalize_prefs(&obj["prefs"]);
        state["draft"] = migrate_draft(&obj["draft"]);
        state["queue"] = json!(self.normalize_queue(&obj["queue"]));
        state["recent"] = json!(self.normalize_recent(&obj["recent"]));
        state
    }

    fn item_key(item: &Value) -> String {
        let obj = item.as_object().cloned().unwrap_or_default();
        let payload = json!({
            "blocks": obj.get("blocks"),
            "qty": obj.get("qty").unwrap_or(&json!(1)),
            "font_size": obj.get("font_size"),
            "font_family": obj.get("font_family"),
            "bold": obj.get("bold"),
            "italic": obj.get("italic"),
            "v_align": obj.get("v_align"),
            "letter_spacing": obj.get("letter_spacing"),
            "margin_h": obj.get("margin_h"),
            "icon_gap": obj.get("icon_gap"),
            "icon_size": obj.get("icon_size"),
        });
        serde_json::to_string(&payload).unwrap_or_default()
    }

    pub fn load(&self) -> Value {
        let path = self.state_path();
        if !path.is_file() {
            return self.default_state();
        }
        match fs::read_to_string(&path) {
            Ok(text) => match serde_json::from_str(&text) {
                Ok(raw) => self.normalize_state(&raw),
                Err(_) => self.default_state(),
            },
            Err(_) => self.default_state(),
        }
    }

    fn save(&self, state: &Value) -> std::io::Result<()> {
        fs::create_dir_all(&self.data_dir)?;
        let normalized = self.normalize_state(state);
        let path = self.state_path();
        let tmp = path.with_extension("json.tmp");
        let text = serde_json::to_string_pretty(&normalized)? + "\n";
        fs::write(&tmp, text)?;
        fs::rename(tmp, path)
    }

    pub fn get(&self) -> Value {
        let _g = self.lock.lock();
        self.load()
    }

    pub fn update(&self, prefs: Option<Value>, draft: Option<Value>, queue: Option<Value>) -> Value {
        let _g = self.lock.lock();
        let mut state = self.load();
        if let Some(p) = prefs {
            state["prefs"] = self.normalize_prefs(&p);
        }
        if let Some(d) = draft {
            state["draft"] = migrate_draft(&d);
        }
        if let Some(q) = queue {
            state["queue"] = json!(self.normalize_queue(&q));
        }
        let _ = self.save(&state);
        state
    }

    pub fn record_print(&self, items: &[Value]) -> Vec<Value> {
        let _g = self.lock.lock();
        let mut state = self.load();
        let mut recent = state["recent"].as_array().cloned().unwrap_or_default();
        let now = chrono_now();

        for raw in items.iter().rev() {
            let meta = if raw.get("meta").is_some() {
                raw.get("meta").unwrap()
            } else {
                raw
            };
            let Some(mut label) = self.normalize_label_from_meta(meta) else {
                continue;
            };
            label["printed_at"] = json!(now);
            let key = Self::item_key(&label);
            recent.retain(|item| Self::item_key(item) != key);
            recent.insert(0, label);
        }

        if recent.len() > RECENT_MAX {
            recent.truncate(RECENT_MAX);
        }
        state["recent"] = json!(recent);
        let _ = self.save(&state);
        state["recent"].as_array().cloned().unwrap_or_default()
    }
}

fn chrono_now() -> String {
    chrono::Utc::now()
        .format("%Y-%m-%dT%H:%M:%SZ")
        .to_string()
}

pub fn normalize_print_meta(raw: &Value, defaults: &LabelDefaults, limits: &Limits) -> Option<Value> {
    if let Some(meta) = raw.get("meta") {
        let store = StateStore::new(PathBuf::new(), defaults.clone(), limits.clone());
        return store.normalize_label_from_meta(meta);
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn draft_migration() {
        let store = StateStore::new(
            PathBuf::from("/tmp/unused"),
            LabelDefaults::from_env(),
            Limits::new(),
        );
        let raw = json!({ "lines": [[{ "type": "text", "value": "hi" }]] });
        let state = store.normalize_state(&json!({ "draft": raw }));
        assert!(state["draft"]["lines"].as_array().unwrap().len() == 1);
    }
}

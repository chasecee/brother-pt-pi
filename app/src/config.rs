use std::env;

use serde::Serialize;
use serde_json::{json, Value};

pub const QUEUE_MAX: usize = 50;
pub const RECENT_MAX: usize = 30;
pub const CUSTOM_ICON_MAX_UPLOAD_BYTES: usize = 10 * 1024 * 1024;
pub const CUSTOM_ICON_MAX_DIM: u32 = 512;

pub const BASELINE_MM: f64 = 18.0;

#[derive(Clone, Debug, Serialize)]
pub struct Limits {
    pub font_size: [i32; 2],
    pub v_align: [i32; 2],
    pub margin_h: [i32; 2],
    pub icon_gap: [i32; 2],
    pub icon_size: [f64; 2],
    pub qty: [i32; 2],
}

impl Limits {
    pub fn new() -> Self {
        Self {
            font_size: [10, 128],
            v_align: [-32, 32],
            margin_h: [0, 128],
            icon_gap: [0, 64],
            icon_size: [0.25, 2.0],
            qty: [1, 99],
        }
    }
}

#[derive(Clone, Debug)]
pub struct LabelDefaults {
    pub font_family: String,
    pub font_size: i32,
    pub bold: bool,
    pub italic: bool,
    pub v_align: i32,
    pub letter_spacing: f64,
    pub margin_h: i32,
    pub icon_gap: i32,
    pub icon_size: f64,
}

impl LabelDefaults {
    pub fn from_env() -> Self {
        Self {
            font_family: env_string("LABEL_FONT_FAMILY", "Helsinki"),
            font_size: env_int("LABEL_FONT_SIZE", 76),
            bold: true,
            italic: false,
            v_align: env_int("LABEL_V_ALIGN", 0),
            letter_spacing: env_float("LABEL_LETTER_SPACING", -0.5),
            margin_h: env_int("LABEL_PAD_PX", 24),
            icon_gap: env_int("LABEL_ICON_GAP", 4),
            icon_size: env_float("LABEL_ICON_SIZE", 1.0),
        }
    }

    pub fn prefs_defaults(&self) -> Value {
        json!({
            "fontFamily": self.font_family,
            "fontSize": self.font_size,
            "bold": self.bold,
            "italic": self.italic,
            "vAlign": self.v_align,
            "letterSpacing": self.letter_spacing,
            "marginH": self.margin_h,
            "iconGap": self.icon_gap,
            "iconSize": self.icon_size,
        })
    }
}

pub fn tape_height_mm() -> f64 {
    env_float("TAPE_HEIGHT_MM", BASELINE_MM)
}

fn env_string(name: &str, default: &str) -> String {
    env::var(name)
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| default.to_string())
}

fn env_int(name: &str, default: i32) -> i32 {
    env::var(name)
        .ok()
        .and_then(|s| s.trim().parse().ok())
        .unwrap_or(default)
}

fn env_float(name: &str, default: f64) -> f64 {
    env::var(name)
        .ok()
        .and_then(|s| s.trim().parse().ok())
        .unwrap_or(default)
}

pub fn clamp_int(val: &Value, default: i32, lo: i32, hi: i32) -> i32 {
    val.as_i64()
        .map(|n| n as i32)
        .unwrap_or(default)
        .clamp(lo, hi)
}

pub fn coerce_float(val: &Value, default: f64) -> f64 {
    val.as_f64().unwrap_or(default)
}

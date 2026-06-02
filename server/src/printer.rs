use std::fs;
use std::path::PathBuf;
use std::process::Command;
use std::thread;
use std::time::Duration;

use anyhow::{anyhow, Context, Result};
use chain_print::{print_files, query_status, StatusJson};
use parking_lot::Mutex;
use serde_json::{json, Value};
use tempfile::TempDir;
use tracing::{error, info, warn};

use crate::config::{preset_for_width, LabelDefaults, Limits};

pub struct PrinterService {
    print_lock: Mutex<()>,
    chain_print_pad: usize,
    chain_print_retries: u32,
    chain_print_retry_delay: f64,
}

impl PrinterService {
    pub fn from_env() -> Self {
        let pad = std::env::var("CHAIN_PRINT_PAD")
            .ok()
            .and_then(|s| s.parse().ok())
            .unwrap_or(0);
        let retries = std::env::var("CHAIN_PRINT_RETRIES")
            .ok()
            .and_then(|s| s.parse().ok())
            .unwrap_or(3)
            .max(1);
        let delay = std::env::var("CHAIN_PRINT_RETRY_DELAY")
            .ok()
            .and_then(|s| s.parse().ok())
            .unwrap_or(1.5);
        Self {
            print_lock: Mutex::new(()),
            chain_print_pad: pad,
            chain_print_retries: retries,
            chain_print_retry_delay: delay,
        }
    }

    pub fn is_printing(&self) -> bool {
        self.print_lock.is_locked()
    }

    pub fn usb_ready(&self) -> bool {
        if cfg!(target_os = "macos") {
            Command::new("ioreg")
                .args(["-p", "IOUSB", "-l"])
                .output()
                .ok()
                .is_some_and(|r| r.status.success() && String::from_utf8_lossy(&r.stdout).contains("PT-P710BT"))
        } else {
            Command::new("lsusb")
                .output()
                .ok()
                .is_some_and(|r| {
                    r.status.success()
                        && String::from_utf8_lossy(&r.stdout)
                            .to_ascii_lowercase()
                            .contains("04f9:20af")
                })
        }
    }

    fn status_to_media(status: &StatusJson) -> Value {
        let preset = if status.media_width_mm > 0 {
            Some(preset_for_width(status.media_width_mm as i32))
        } else {
            None
        };
        json!({
            "ok": true,
            "width_mm": status.media_width_mm,
            "kind": status.media_kind,
            "height_px": status.height_px,
            "tape_color": status.tape_color,
            "text_color": status.text_color,
            "errors": status.errors,
            "ready": status.ready,
            "preset": preset,
            "err": "",
        })
    }

    pub fn query_media(&self) -> Value {
        match query_status() {
            Ok(status) => Self::status_to_media(&status),
            Err(e) => json!({
                "ok": false,
                "width_mm": 0,
                "kind": "",
                "height_px": 0,
                "tape_color": "",
                "text_color": "",
                "errors": [],
                "ready": false,
                "preset": null,
                "err": e.to_string(),
            }),
        }
    }

    pub fn print_pngs(&self, png_paths: &[PathBuf]) -> Result<usize> {
        let _guard = self.print_lock.lock();

        if !self.usb_ready() {
            return Err(anyhow!("printer not connected"));
        }

        let mut last_err = anyhow!("print failed");
        for attempt in 0..self.chain_print_retries {
            if attempt > 0 {
                warn!(
                    "print: retry {}/{} after err={last_err:#}",
                    attempt,
                    self.chain_print_retries - 1
                );
                thread::sleep(Duration::from_secs_f64(
                    self.chain_print_retry_delay * attempt as f64,
                ));
            }
            match print_files(self.chain_print_pad, png_paths) {
                Ok(()) => {
                    info!("print: ok count={} attempt={}", png_paths.len(), attempt + 1);
                    thread::sleep(Duration::from_millis(500));
                    return Ok(png_paths.len());
                }
                Err(e) => {
                    error!("print: attempt={} err={e:#}", attempt + 1);
                    last_err = e;
                    let err_s = last_err.to_string().to_lowercase();
                    if !err_s.contains("connect")
                        && !err_s.contains("usb")
                        && !err_s.contains("index")
                    {
                        break;
                    }
                }
            }
        }
        thread::sleep(Duration::from_millis(500));
        Err(last_err)
    }

    pub fn print_labels_from_pngs(
        &self,
        labels: &[(Vec<u8>, u32)],
        _defaults: &LabelDefaults,
        _limits: &Limits,
    ) -> Result<usize> {
        let dir = TempDir::new().context("temp dir")?;
        let mut paths = Vec::new();
        for (i, (png, qty)) in labels.iter().enumerate() {
            for q in 0..*qty {
                let path = dir.path().join(format!("label_{i}_{q}.png"));
                fs::write(&path, png)?;
                paths.push(path);
            }
        }
        self.print_pngs(&paths)
    }
}


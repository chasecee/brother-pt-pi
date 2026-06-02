use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::thread;
use std::time::{Duration, Instant};

use anyhow::{anyhow, Context, Result};
use chain_print::{print_files, query_status, StatusJson};
use parking_lot::Mutex;
use serde_json::{json, Value};
use tempfile::TempDir;
use tracing::{error, info, warn};

use crate::config::{preset_for_width, LabelDefaults, Limits};

pub struct PrinterService {
    print_lock: Mutex<()>,
    media_cache: Mutex<Option<Value>>,
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
            media_cache: Mutex::new(None),
            chain_print_pad: pad,
            chain_print_retries: retries,
            chain_print_retry_delay: delay,
        }
    }

    pub fn is_printing(&self) -> bool {
        self.print_lock.is_locked()
    }

    pub fn cached_media(&self) -> Option<Value> {
        self.media_cache.lock().clone()
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
            Ok(status) => {
                let payload = Self::status_to_media(&status);
                *self.media_cache.lock() = Some(payload.clone());
                payload
            }
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

    pub fn wake(&self) -> Value {
        let printer_dev = find_printer_sysfs();
        info!("wake: printer_sysfs={:?} usb_ready={}", printer_dev, self.usb_ready());

        // VBUS power-cycle is only safe on host controllers that genuinely
        // support per-port power switching. Pi Zero / Pi 1 use dwc_otg which
        // advertises PPPS but the kernel driver rejects the hub control
        // requests — uhubctl "off" disables the port, and uhubctl "on" is a
        // no-op, so the port stays dead until reboot. Skip vbus_cycle there
        // and rely on the printer's own Auto-Power-On (configured via
        // P-touch Editor) to wake from USB activity.
        if controller_supports_vbus_cycle() {
            let locations = printer_dev
                .as_ref()
                .map(|dev| hub_chain(dev))
                .unwrap_or_default();
            if let Err(err) = vbus_cycle(&locations) {
                error!("wake: vbus cycle failed: {err}");
                return json!({ "ok": false, "err": err.to_string() });
            }
            let deadline = Instant::now() + Duration::from_secs(12);
            let mut waited = 0.0;
            while Instant::now() < deadline {
                if self.usb_ready() {
                    info!("wake: re-enumerated after {waited:.1}s");
                    break;
                }
                thread::sleep(Duration::from_millis(500));
                waited += 0.5;
            }
            if !self.usb_ready() {
                error!("wake: printer never re-enumerated within {waited:.1}s");
                return json!({
                    "ok": false,
                    "err": "printer did not re-enumerate after VBUS cycle - check Auto Power On in Brother's settings tool",
                });
            }
            thread::sleep(Duration::from_millis(1500));
        } else if !self.usb_ready() {
            info!("wake: vbus cycle unsupported on this controller; printer not visible");
            return json!({
                "ok": false,
                "err": "printer not connected (host controller does not support VBUS power cycling - enable Auto Power On in Brother's settings tool and physically reconnect)",
            });
        }
        let media = self.query_media();
        if !media.get("ok").and_then(|v| v.as_bool()).unwrap_or(false) {
            let err = media
                .get("err")
                .and_then(|v| v.as_str())
                .unwrap_or("status query failed");
            error!("wake: status query failed: {err}");
            return json!({ "ok": false, "err": err });
        }
        let width = media.get("width_mm").and_then(|v| v.as_u64()).unwrap_or(0);
        let tape = media.get("tape_color").and_then(|v| v.as_str()).unwrap_or("");
        let text = media.get("text_color").and_then(|v| v.as_str()).unwrap_or("");
        let mut info = format!("{width} mm");
        if !tape.is_empty() && !text.is_empty() {
            info.push_str(&format!(" · {tape}/{text}"));
        }
        json!({ "ok": true, "info": info, "media": media })
    }

    pub fn print_pngs(&self, png_paths: &[PathBuf]) -> Result<usize> {
        let _guard = self.print_lock.lock();

        // If the printer is not visible at all, do one wake (which vbus-cycles
        // the root hub to power on a sleeping/off printer) before giving up.
        // Skips the 3x retry storm when the printer is simply unplugged.
        if find_printer_sysfs().is_none() && !self.usb_ready() {
            info!("print: no printer visible, attempting single wake");
            let _ = self.wake();
            if !self.usb_ready() {
                return Err(anyhow!(
                    "printer not connected (USB vendor {PRINTER_VID} not present after wake)"
                ));
            }
        }

        let mut last_err = anyhow!("print failed");
        for attempt in 0..self.chain_print_retries {
            if attempt > 0 {
                warn!(
                    "print: retry {}/{} after err={last_err:#}",
                    attempt,
                    self.chain_print_retries - 1
                );
                let err_s = last_err.to_string().to_lowercase();
                if err_s.contains("connect") || err_s.contains("usb") || err_s.contains("index") {
                    let _ = self.wake();
                }
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

const PRINTER_VID: &str = "04f9";
const PRINTER_PID: &str = "20af";

// Pi Zero / Pi 1 use dwc_otg which can't actually power-cycle its single USB
// port; calling uhubctl off+on permanently disables the port until reboot.
fn controller_supports_vbus_cycle() -> bool {
    if Path::new("/sys/bus/platform/drivers/dwc_otg").is_dir() {
        return false;
    }
    Command::new("uhubctl").output().is_ok()
}

fn find_printer_sysfs() -> Option<PathBuf> {
    let root = Path::new("/sys/bus/usb/devices");
    if !root.is_dir() {
        return None;
    }
    for dev in fs::read_dir(root).ok()? {
        let dev = dev.ok()?.path();
        let v = dev.join("idVendor");
        let p = dev.join("idProduct");
        if !v.exists() || !p.exists() {
            continue;
        }
        if fs::read_to_string(v).ok()?.trim() == PRINTER_VID
            && fs::read_to_string(p).ok()?.trim() == PRINTER_PID
        {
            return Some(dev);
        }
    }
    None
}

fn hub_chain(printer_dev: &Path) -> Vec<String> {
    let mut chain = Vec::new();
    let mut cur = printer_dev.canonicalize().ok();
    while let Some(ref path) = cur {
        if path.file_name().and_then(|n| n.to_str()) == Some("devices") {
            break;
        }
        let class_f = path.join("bDeviceClass");
        if class_f.is_file() {
            if fs::read_to_string(&class_f)
                .ok()
                .is_some_and(|s| s.trim() == "09")
            {
                let name = path
                    .file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or("");
                let loc = if name.starts_with("usb") {
                    name[3..].to_string()
                } else {
                    name.to_string()
                };
                chain.push(loc);
            }
        }
        cur = path.parent().map(Path::to_path_buf);
    }
    chain
}

fn all_root_hubs() -> Vec<String> {
    let root = Path::new("/sys/bus/usb/devices");
    if !root.is_dir() {
        return vec![];
    }
    let mut out = Vec::new();
    if let Ok(entries) = fs::read_dir(root) {
        for entry in entries.flatten() {
            let name = entry.file_name();
            let name = name.to_string_lossy();
            if name.starts_with("usb") {
                let suffix = &name[3..];
                if suffix.chars().all(|c| c.is_ascii_digit()) {
                    out.push(suffix.to_string());
                }
            }
        }
    }
    out.sort();
    out
}

fn vbus_cycle(locations: &[String]) -> Result<()> {
    if Command::new("uhubctl").output().is_err() {
        return Err(anyhow::anyhow!("uhubctl not installed"));
    }
    let targets = if locations.is_empty() {
        all_root_hubs()
    } else {
        locations.to_vec()
    };
    if targets.is_empty() {
        return Err(anyhow::anyhow!("no USB root hubs found"));
    }
    info!("vbus_cycle: targets={targets:?}");
    for loc in &targets {
        let r = Command::new("uhubctl")
            .args(["-a", "off", "-l", loc])
            .output()
            .context("uhubctl off")?;
        if !r.status.success() {
            return Err(anyhow::anyhow!(
                "uhubctl off failed: {}",
                String::from_utf8_lossy(&r.stderr)
            ));
        }
    }
    thread::sleep(Duration::from_secs(2));
    for loc in &targets {
        let r = Command::new("uhubctl")
            .args(["-a", "on", "-l", loc])
            .output()
            .context("uhubctl on")?;
        if !r.status.success() {
            return Err(anyhow::anyhow!(
                "uhubctl on failed: {}",
                String::from_utf8_lossy(&r.stderr)
            ));
        }
    }
    Ok(())
}

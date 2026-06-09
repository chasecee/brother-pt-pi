use std::fs;
use std::path::PathBuf;
use std::process::Command;
use std::thread;
use std::time::Duration;

use anyhow::{anyhow, Context, Result};
use axum::extract::State;
use axum::http::StatusCode;
use axum::routing::{get, post};
use axum::{Json, Router};
use base64::Engine;
use chain_print::{print_files, query_status, StatusJson};
use clap::Parser;
use parking_lot::Mutex;
use serde::Deserialize;
use serde_json::{json, Value};
use tempfile::TempDir;
use tracing::{error, info, warn};
use tracing_subscriber::EnvFilter;

#[derive(Parser)]
#[command(name = "ptlabel-bridge")]
struct Args {
    #[arg(long, default_value = "0.0.0.0")]
    host: String,
    #[arg(long, default_value_t = 7777)]
    port: u16,
    #[arg(long, env = "PTLABEL_MDNS_NAME", default_value = "bridge")]
    mdns_name: String,
}

#[derive(Deserialize)]
struct PrintLabelItem {
    png_b64: String,
    qty: Option<u32>,
}

#[derive(Deserialize)]
struct PrintRequest {
    labels: Vec<PrintLabelItem>,
}

struct BridgeService {
    print_lock: Mutex<()>,
    chain_print_pad: usize,
    chain_print_retries: u32,
    chain_print_retry_delay: f64,
}

impl BridgeService {
    fn from_env() -> Self {
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

    fn is_printing(&self) -> bool {
        self.print_lock.is_locked()
    }

    fn usb_ready(&self) -> bool {
        Command::new("lsusb").output().ok().is_some_and(|r| {
            r.status.success()
                && String::from_utf8_lossy(&r.stdout)
                    .to_ascii_lowercase()
                    .contains("04f9:20af")
        })
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

    fn query_media(&self) -> Value {
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

    fn print_pngs(&self, png_paths: &[PathBuf]) -> Result<usize> {
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

    fn print_labels_from_pngs(&self, labels: &[(Vec<u8>, u32)]) -> Result<usize> {
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

fn decode_png_field(raw: &str) -> Result<Vec<u8>, String> {
    let b64 = raw.strip_prefix("data:image/png;base64,").unwrap_or(raw);
    base64::engine::general_purpose::STANDARD
        .decode(b64)
        .map_err(|e| e.to_string())
}

fn preset_for_width(mm: i32) -> Value {
    let height_px_map = [(6, 32), (9, 50), (12, 70), (18, 112), (24, 128)];
    let (mm, h) = height_px_map
        .iter()
        .find(|(w, _)| *w == mm)
        .map(|(w, h)| (*w, *h))
        .unwrap_or((18, 112));
    let s = h as f64 / 112.0;
    let base_font = 76.0;
    let base_margin = 24.0;
    let base_v = 0.0;
    let (font_size, v_align, letter_spacing) = if mm == 12 {
        (58, -2, -1.0)
    } else {
        ((base_font * s).round() as i64, (base_v * s).round() as i64, -0.5)
    };
    json!({
        "width_mm": mm,
        "height_px": h,
        "font_size": font_size,
        "margin_h": (base_margin * s).round() as i64,
        "v_align": v_align,
        "letter_spacing": letter_spacing,
    })
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::from_default_env().add_directive("ptlabel_bridge=info".parse()?),
        )
        .init();

    let args = Args::parse();
    let bridge = std::sync::Arc::new(BridgeService::from_env());

    let app = Router::new()
        .route("/status", get(api_status))
        .route("/media", get(api_media))
        .route("/print", post(api_print))
        .with_state(bridge);

    let addr: std::net::SocketAddr = format!("{}:{}", args.host, args.port).parse()?;
    tracing::info!("ptlabel-bridge listening on http://{addr}");

    advertise_mdns(&args.mdns_name, args.port);

    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app.into_make_service()).await?;
    Ok(())
}

fn advertise_mdns(name: &str, port: u16) {
    let name = name.trim().trim_end_matches('.').trim_end_matches(".local");
    if name.is_empty() {
        tracing::info!("mdns: disabled (empty name)");
        return;
    }
    let daemon = match mdns_sd::ServiceDaemon::new() {
        Ok(d) => d,
        Err(e) => {
            tracing::warn!("mdns: daemon init failed: {e}");
            return;
        }
    };
    let host_name = format!("{name}.local.");
    let info = match mdns_sd::ServiceInfo::new(
        "_http._tcp.local.",
        "PTLabelBridge",
        &host_name,
        "",
        port,
        &[("path", "/status")][..],
    ) {
        Ok(i) => i.enable_addr_auto(),
        Err(e) => {
            tracing::warn!("mdns: invalid service info: {e}");
            return;
        }
    };
    match daemon.register(info) {
        Ok(()) => tracing::info!("mdns: advertising {host_name} _http._tcp port {port}"),
        Err(e) => {
            tracing::warn!("mdns: register failed: {e}");
            return;
        }
    }
    static MDNS: std::sync::OnceLock<mdns_sd::ServiceDaemon> = std::sync::OnceLock::new();
    let _ = MDNS.set(daemon);
}

async fn api_status(State(bridge): State<std::sync::Arc<BridgeService>>) -> Json<Value> {
    Json(json!({
        "ok": bridge.usb_ready(),
        "printing": bridge.is_printing(),
    }))
}

async fn api_media(State(bridge): State<std::sync::Arc<BridgeService>>) -> Json<Value> {
    Json(bridge.query_media())
}

async fn api_print(
    State(bridge): State<std::sync::Arc<BridgeService>>,
    Json(body): Json<PrintRequest>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    if body.labels.is_empty() {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({ "ok": false, "err": "no labels" })),
        ));
    }
    let mut png_labels: Vec<(Vec<u8>, u32)> = Vec::new();
    for item in &body.labels {
        let png = decode_png_field(&item.png_b64).map_err(|e| {
            (
                StatusCode::BAD_REQUEST,
                Json(json!({ "ok": false, "err": e })),
            )
        })?;
        if png.is_empty() {
            return Err((
                StatusCode::BAD_REQUEST,
                Json(json!({ "ok": false, "err": "empty png" })),
            ));
        }
        let qty = item.qty.unwrap_or(1).clamp(1, 99);
        png_labels.push((png, qty));
    }

    match bridge.print_labels_from_pngs(&png_labels) {
        Ok(count) => Ok(Json(json!({ "ok": true, "count": count, "err": "" }))),
        Err(e) => Err((
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "ok": false, "err": e.to_string() })),
        )),
    }
}

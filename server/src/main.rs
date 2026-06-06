mod blocks;
mod config;
mod fonts;
mod icons;
mod printer;
mod state;
mod sysinfo;
mod tls;

use std::net::SocketAddr;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use axum::body::Bytes;
use axum::extract::{Multipart, Query, Request, State};
use axum::http::{header, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{any, get, post};
use axum::{Json, Router};
use base64::Engine;
use clap::Parser;
use serde::Deserialize;
use serde_json::{json, Value};
use tower_http::compression::CompressionLayer;
use tower_http::services::{ServeDir, ServeFile};
use tower_http::set_header::SetResponseHeaderLayer;
use tower_http::CompressionLevel;
use tracing_subscriber::EnvFilter;

use crate::config::{tape_height_mm, LabelDefaults, Limits, CUSTOM_ICON_MAX_UPLOAD_BYTES};
use crate::icons::{custom_icon_path, save_custom_icon};
use crate::printer::PrinterService;
use crate::state::StateStore;

#[derive(Parser)]
#[command(name = "ptlabel-server")]
struct Args {
    #[arg(long, default_value = "0.0.0.0")]
    host: String,
    #[arg(long, default_value_t = 5000)]
    port: u16,
    #[arg(long, env = "PTLABEL_ROOT")]
    root: Option<PathBuf>,
    #[arg(long, env = "PTLABEL_DATA_DIR")]
    data_dir: Option<PathBuf>,
    #[arg(long, env = "PTLABEL_DEV", default_value_t = false)]
    dev: bool,
}

#[derive(Clone)]
struct AppState {
    root: PathBuf,
    data_dir: PathBuf,
    defaults: LabelDefaults,
    limits: Limits,
    store: Arc<StateStore>,
    printer: Arc<PrinterService>,
    asset_version: String,
}

#[derive(Deserialize)]
struct IconQuery {
    category: Option<String>,
}

#[derive(Deserialize)]
struct IconSearchQuery {
    q: Option<String>,
}

#[derive(Deserialize)]
struct PrintLabelItem {
    png: String,
    qty: Option<u32>,
    meta: Option<Value>,
}

#[derive(Deserialize)]
struct PrintRequest {
    labels: Vec<PrintLabelItem>,
}

#[derive(Deserialize)]
struct StateUpdate {
    prefs: Option<Value>,
    draft: Option<Value>,
    queue: Option<Value>,
}

fn decode_png_field(raw: &str) -> Result<Vec<u8>, String> {
    let b64 = raw.strip_prefix("data:image/png;base64,").unwrap_or(raw);
    base64::engine::general_purpose::STANDARD
        .decode(b64)
        .map_err(|e| e.to_string())
}

fn find_root() -> PathBuf {
    if let Ok(cwd) = std::env::current_dir() {
        if cwd.join("static").join("index.html").is_file() {
            return cwd;
        }
    }
    std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(Path::to_path_buf))
        .and_then(|p| p.parent().map(Path::to_path_buf))
        .unwrap_or_else(|| PathBuf::from("."))
}

fn deployed_at_from_static_index(root: &Path) -> String {
    let index_path = root.join("static").join("index.html");
    std::fs::metadata(index_path)
        .ok()
        .and_then(|m| m.modified().ok())
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs().to_string())
        .unwrap_or_else(|| "0".to_string())
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::from_default_env().add_directive("ptlabel_server=info".parse()?),
        )
        .init();

    let args = Args::parse();
    let root = args.root.unwrap_or_else(|| {
        std::env::var("PTLABEL_STATIC_DIR")
            .ok()
            .map(PathBuf::from)
            .unwrap_or_else(find_root)
    });
    let data_dir = args.data_dir.unwrap_or_else(|| root.join("data"));

    rustls_rustcrypto::provider()
        .install_default()
        .map_err(|_| anyhow::anyhow!("rustls provider already installed"))?;
    let tls_config = tls::load(&data_dir).await?;
    let defaults = LabelDefaults::from_env();
    let limits = Limits::new();
    let store = Arc::new(StateStore::new(
        data_dir.clone(),
        defaults.clone(),
        limits.clone(),
    ));
    let printer = Arc::new(PrinterService::from_env());

    let state = AppState {
        root: root.clone(),
        data_dir,
        defaults,
        limits,
        store,
        printer,
        asset_version: deployed_at_from_static_index(&root),
    };

    let cache_policy = SetResponseHeaderLayer::if_not_present(
        header::CACHE_CONTROL,
        if args.dev {
            header::HeaderValue::from_static("no-store")
        } else {
            header::HeaderValue::from_static("public, max-age=31536000, immutable")
        },
    );

    let serve_dir = |path: PathBuf| {
        ServeDir::new(path)
            .precompressed_br()
            .precompressed_gzip()
    };

    let static_assets = Router::new()
        .nest_service("/", serve_dir(root.join("static")))
        .layer(cache_policy.clone());

    let font_previews = Router::new()
        .nest_service("/", serve_dir(root.join("fonts").join("previews")))
        .layer(cache_policy.clone());
    let fonts_static = Router::new()
        .nest_service("/", serve_dir(root.join("fonts")))
        .layer(cache_policy.clone());
    let icon_thumbs = Router::new()
        .nest_service("/", serve_dir(root.join("icons").join("thumbs")))
        .layer(cache_policy.clone());

    let icons_root = root.join("icons");
    let icon_catalog_file = Router::new()
        .route_service(
            "/",
            ServeFile::new(icons_root.join("catalog.json"))
                .precompressed_br()
                .precompressed_gzip(),
        )
        .layer(cache_policy.clone());
    let icon_sprite_file = Router::new()
        .route_service(
            "/",
            ServeFile::new(icons_root.join("category-sprite.png")),
        )
        .layer(cache_policy.clone());

    let app = Router::new()
        .route("/", get(index))
        .route("/api/config", get(api_config))
        .route("/api/state", get(api_state_get).put(api_state_put))
        .route("/api/status", get(api_status))
        .route("/api/media", get(api_media))
        .route("/api/print", post(api_print))
        .route("/api/fonts", get(api_fonts))
        .route("/api/icons/categories", get(api_icon_categories))
        .route("/api/icons/search", get(api_icon_search))
        .route("/api/icons", get(api_icons))
        .route("/api/icons/custom", post(api_icon_custom))
        .route("/icons/custom/:uuid", get(icon_custom_file))
        .nest_service("/icons/catalog.json", icon_catalog_file)
        .nest_service("/icons/category-sprite.png", icon_sprite_file)
        .nest("/static", static_assets)
        .nest("/font-previews", font_previews)
        .nest("/fonts", fonts_static)
        .nest("/icons/thumbs", icon_thumbs)
        .layer(
            CompressionLayer::new()
                .br(true)
                .gzip(true)
                .quality(CompressionLevel::Fastest),
        )
        .with_state(state);

    let addr: SocketAddr = format!("{}:{}", args.host, args.port).parse()?;
    tracing::info!(
        "ptlabel-server listening on https://{addr} (dev={})",
        args.dev
    );

    spawn_http_redirect(args.host.clone(), args.port);

    axum_server::bind_rustls(addr, tls_config)
        .serve(app.into_make_service())
        .await?;
    Ok(())
}

fn spawn_http_redirect(host: String, https_port: u16) {
    let addr: SocketAddr = match format!("{host}:80").parse() {
        Ok(a) => a,
        Err(e) => {
            tracing::warn!("http redirect: bad bind addr {host}:80: {e}");
            return;
        }
    };
    let app = Router::new()
        .fallback(any(redirect_to_https))
        .with_state(https_port);
    tokio::spawn(async move {
        match tokio::net::TcpListener::bind(addr).await {
            Ok(listener) => {
                tracing::info!("http->https redirect listening on http://{addr}");
                if let Err(e) = axum::serve(listener, app).await {
                    tracing::warn!("http redirect listener exited: {e}");
                }
            }
            Err(e) => tracing::warn!("http redirect listener on :80 not started: {e}"),
        }
    });
}

async fn redirect_to_https(State(https_port): State<u16>, req: Request) -> Response {
    let host = req
        .headers()
        .get(header::HOST)
        .and_then(|h| h.to_str().ok())
        .map(|h| h.split(':').next().unwrap_or(h))
        .filter(|h| !h.is_empty());
    let Some(host) = host else {
        return (StatusCode::BAD_REQUEST, "missing Host header").into_response();
    };
    let pq = req
        .uri()
        .path_and_query()
        .map(|p| p.as_str())
        .unwrap_or("/");
    let location = if https_port == 443 {
        format!("https://{host}{pq}")
    } else {
        format!("https://{host}:{https_port}{pq}")
    };
    (
        StatusCode::PERMANENT_REDIRECT,
        [(header::LOCATION, location)],
    )
        .into_response()
}

async fn index(State(state): State<AppState>) -> Response {
    match tokio::fs::read_to_string(state.root.join("static").join("index.html")).await {
        Ok(html) => (
            StatusCode::OK,
            [
                (header::CONTENT_TYPE, "text/html; charset=utf-8"),
                (header::CACHE_CONTROL, "no-cache"),
            ],
            html,
        )
            .into_response(),
        Err(_) => (StatusCode::NOT_FOUND, "index.html not found").into_response(),
    }
}

async fn api_config(State(state): State<AppState>) -> Json<Value> {
    Json(json!({
        "prefs": state.defaults.prefs_defaults(),
        "limits": state.limits,
        "tapeHeightMm": tape_height_mm(),
    }))
}

async fn api_state_get(State(state): State<AppState>) -> Json<Value> {
    Json(state.store.get())
}

async fn api_state_put(
    State(state): State<AppState>,
    Json(body): Json<StateUpdate>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    if body.prefs.is_none() && body.draft.is_none() && body.queue.is_none() {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({ "ok": false, "err": "no fields" })),
        ));
    }
    Ok(Json(state.store.update(body.prefs, body.draft, body.queue)))
}

async fn api_status(State(state): State<AppState>) -> Json<Value> {
    let mut body = json!({
        "ok": state.printer.usb_ready(),
        "printing": state.printer.is_printing(),
        "info": "",
        "err": "",
        "deployed_at": state.asset_version,
    });
    let map = body.as_object_mut().unwrap();
    for (k, v) in sysinfo::linux_sysinfo() {
        map.insert(k, v);
    }
    Json(body)
}

async fn api_media(
    State(state): State<AppState>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    if state.printer.is_printing() {
        return Err((
            StatusCode::CONFLICT,
            Json(json!({ "ok": false, "err": "printing" })),
        ));
    }
    Ok(Json(state.printer.query_media()))
}

async fn api_print(
    State(state): State<AppState>,
    Json(body): Json<PrintRequest>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    if body.labels.is_empty() {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({ "ok": false, "err": "no labels" })),
        ));
    }

    let lim = &state.limits;
    let mut png_labels: Vec<(Vec<u8>, u32)> = Vec::new();
    let mut meta_items: Vec<Value> = Vec::new();

    for item in &body.labels {
        let png = decode_png_field(&item.png).map_err(|e| {
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
        let qty = item
            .qty
            .unwrap_or(1)
            .clamp(lim.qty[0] as u32, lim.qty[1] as u32);
        png_labels.push((png, qty));
        if let Some(meta) = &item.meta {
            meta_items.push(meta.clone());
        } else {
            meta_items.push(json!({}));
        }
    }

    match state
        .printer
        .print_labels_from_pngs(&png_labels, &state.defaults, &state.limits)
    {
        Ok(count) => {
            let recent = state.store.record_print(&meta_items);
            Ok(Json(json!({
                "ok": true,
                "out": "",
                "count": count,
                "recent": recent,
            })))
        }
        Err(e) => Err((
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "ok": false, "err": e.to_string() })),
        )),
    }
}

async fn api_fonts(State(state): State<AppState>) -> Json<Value> {
    Json(fonts::list_fonts(&state.root))
}

async fn api_icon_categories(State(state): State<AppState>) -> Json<Value> {
    Json(icons::list_categories(&state.root))
}

async fn api_icons(
    State(state): State<AppState>,
    Query(q): Query<IconQuery>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let category = q.category.unwrap_or_default().trim().to_string();
    if category.is_empty() {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({ "ok": false, "err": "category required" })),
        ));
    }
    Ok(Json(
        json!({ "icons": icons::icons_in_category(&state.root, &category) }),
    ))
}

async fn api_icon_search(
    State(state): State<AppState>,
    Query(q): Query<IconSearchQuery>,
) -> Json<Value> {
    let query = q.q.unwrap_or_default();
    Json(json!({ "icons": icons::search_icons(&state.root, &query, 500) }))
}

async fn api_icon_custom(
    State(state): State<AppState>,
    mut multipart: Multipart,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let mut file_bytes: Option<Bytes> = None;
    while let Some(field) = multipart.next_field().await.map_err(|e| {
        (
            StatusCode::BAD_REQUEST,
            Json(json!({ "ok": false, "err": e.to_string() })),
        )
    })? {
        if field.name() == Some("file") {
            let data = field.bytes().await.map_err(|e| {
                (
                    StatusCode::BAD_REQUEST,
                    Json(json!({ "ok": false, "err": e.to_string() })),
                )
            })?;
            file_bytes = Some(data);
            break;
        }
    }
    let Some(bytes) = file_bytes else {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({ "ok": false, "err": "no file" })),
        ));
    };
    if bytes.len() > CUSTOM_ICON_MAX_UPLOAD_BYTES {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({ "ok": false, "err": "file too large" })),
        ));
    }
    match save_custom_icon(&state.data_dir, &bytes) {
        Ok((id, thumb_url)) => Ok(Json(
            json!({ "ok": true, "id": id, "thumb_url": thumb_url }),
        )),
        Err(e) => Err((
            StatusCode::BAD_REQUEST,
            Json(json!({ "ok": false, "err": e.to_string() })),
        )),
    }
}

async fn icon_custom_file(
    State(state): State<AppState>,
    axum::extract::Path(uuid): axum::extract::Path<String>,
) -> Result<Response, StatusCode> {
    let path = custom_icon_path(&state.data_dir, &format!("custom:{uuid}"));
    let Some(path) = path else {
        return Err(StatusCode::NOT_FOUND);
    };
    match tokio::fs::read(&path).await {
        Ok(bytes) => {
            Ok((StatusCode::OK, [(header::CONTENT_TYPE, "image/png")], bytes).into_response())
        }
        Err(_) => Err(StatusCode::NOT_FOUND),
    }
}

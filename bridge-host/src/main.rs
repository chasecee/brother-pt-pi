use std::io::{Read, Write};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use anyhow::{Context, Result};
use axum::extract::State;
use axum::routing::get;
use axum::{Json, Router};
use clap::Parser;
use protocol::bridge::{BridgeHealth, BridgeInfo, PrinterInfo};
use protocol::{PORT_ADMIN, PORT_TUNNEL, PRINTER_PID_PT_P710BT, PRINTER_VID};
use rusb::{Context as UsbCtx, Device, DeviceDescriptor, DeviceHandle, Direction, TransferType, UsbContext};
use tokio::sync::Semaphore;

#[derive(Parser)]
struct Args {
    #[arg(long, default_value = "0.0.0.0")]
    host: String,
    #[arg(long, default_value_t = PORT_TUNNEL)]
    tunnel_port: u16,
    #[arg(long, default_value_t = PORT_ADMIN + 1)]
    admin_port: u16,
    #[arg(long, default_value_t = 200)]
    io_timeout_ms: u64,
}

#[derive(Clone)]
struct AppState {
    start: Instant,
}

struct UsbSession {
    handle: DeviceHandle<UsbCtx>,
    cmd_ep: u8,
    stat_ep: u8,
}

#[tokio::main]
async fn main() -> Result<()> {
    let args = Args::parse();
    let active_client = Arc::new(AtomicBool::new(false));
    let state = AppState {
        start: Instant::now(),
    };

    let tcp_addr = format!("{}:{}", args.host, args.tunnel_port);
    let admin_addr = format!("{}:{}", args.host, args.admin_port);
    let timeout = Duration::from_millis(args.io_timeout_ms);
    let gate = Arc::new(Semaphore::new(1));

    let admin_app = Router::new()
        .route("/health", get(health))
        .route("/info", get(info))
        .with_state(state.clone());
    let admin_listener = tokio::net::TcpListener::bind(&admin_addr)
        .await
        .with_context(|| format!("bind admin {admin_addr}"))?;
    tokio::spawn(async move {
        let _ = axum::serve(admin_listener, admin_app).await;
    });

    let listener = tokio::net::TcpListener::bind(&tcp_addr)
        .await
        .with_context(|| format!("bind tunnel {tcp_addr}"))?;
    println!("bridge-host listening tcp={tcp_addr} admin={admin_addr}");

    loop {
        let (socket, peer) = listener.accept().await.context("accept client")?;
        let Ok(permit) = gate.clone().try_acquire_owned() else {
            println!("rejecting {peer}: active client exists");
            continue;
        };
        let active_client = active_client.clone();
        tokio::spawn(async move {
            let _permit = permit;
            active_client.store(true, Ordering::Relaxed);
            let result = tokio::task::spawn_blocking(move || -> Result<()> {
                let mut std_socket = socket.into_std().context("socket into_std")?;
                std_socket
                    .set_nodelay(true)
                    .context("set_nodelay tunnel socket")?;
                std_socket
                    .set_read_timeout(Some(Duration::from_millis(20)))
                    .context("set socket read timeout")?;
                std_socket
                    .set_write_timeout(Some(Duration::from_millis(20)))
                    .context("set socket write timeout")?;
                let mut usb = open_usb(timeout)?;
                proxy_loop(&mut std_socket, &mut usb, timeout)
            })
            .await;
            active_client.store(false, Ordering::Relaxed);
            match result {
                Ok(Ok(())) => println!("client {peer} disconnected"),
                Ok(Err(e)) => eprintln!("client {peer} failed: {e:#}"),
                Err(e) => eprintln!("client {peer} task join failed: {e}"),
            }
        });
    }
}

fn proxy_loop(
    socket: &mut std::net::TcpStream,
    usb: &mut UsbSession,
    timeout: Duration,
) -> Result<()> {
    let mut net_buf = [0u8; 2048];
    let mut usb_buf = [0u8; 512];
    loop {
        match socket.read(&mut net_buf) {
            Ok(0) => return Ok(()),
            Ok(n) => {
                usb.handle
                    .write_bulk(usb.cmd_ep, &net_buf[..n], timeout)
                    .with_context(|| format!("usb write {} bytes", n))?;
            }
            Err(e)
                if e.kind() == std::io::ErrorKind::WouldBlock
                    || e.kind() == std::io::ErrorKind::TimedOut => {}
            Err(e) => return Err(e).context("socket read"),
        }

        match usb.handle.read_bulk(usb.stat_ep, &mut usb_buf, timeout) {
            Ok(0) => {}
            Ok(n) => socket
                .write_all(&usb_buf[..n])
                .with_context(|| format!("socket write {} bytes", n))?,
            Err(rusb::Error::Timeout) => {}
            Err(e) => return Err(anyhow::anyhow!(e)).context("usb read"),
        }
    }
}

fn open_usb(timeout: Duration) -> Result<UsbSession> {
    let context = UsbCtx::new().context("usb context")?;
    let devices = context.devices().context("usb devices")?;
    let (device, _descriptor) = devices
        .iter()
        .filter_map(|d| d.device_descriptor().ok().map(|desc| (d, desc)))
        .find(|(_, desc)| desc.vendor_id() == PRINTER_VID && desc.product_id() == PRINTER_PID_PT_P710BT)
        .context("printer usb device not found")?;

    let handle = device.open().context("open printer handle")?;
    #[cfg(not(target_os = "macos"))]
    handle.reset().context("reset printer")?;

    let config_desc = device.config_descriptor(0).context("config descriptor")?;
    let interface = config_desc
        .interfaces()
        .next()
        .context("usb interface missing")?;

    let (mut cmd_ep, mut stat_ep) = (None, None);
    for desc in interface.descriptors() {
        for ep in desc.endpoint_descriptors() {
            match (ep.transfer_type(), ep.direction()) {
                (TransferType::Bulk, Direction::Out) => cmd_ep = Some(ep.address()),
                (TransferType::Bulk, Direction::In) => stat_ep = Some(ep.address()),
                _ => {}
            }
        }
    }
    let cmd_ep = cmd_ep.context("bulk out endpoint missing")?;
    let stat_ep = stat_ep.context("bulk in endpoint missing")?;

    let if_num = interface.number();
    if handle.kernel_driver_active(if_num).unwrap_or(false) {
        let _ = handle.detach_kernel_driver(if_num);
    }
    handle
        .claim_interface(if_num)
        .with_context(|| format!("claim interface {}", if_num))?;
    let _ = handle.write_bulk(cmd_ep, &[0u8; 100], timeout);
    let _ = handle.write_bulk(cmd_ep, &[0x1b, 0x40], timeout);

    Ok(UsbSession {
        handle,
        cmd_ep,
        stat_ep,
    })
}

fn probe_printer() -> Option<PrinterInfo> {
    let context = UsbCtx::new().ok()?;
    let devices = context.devices().ok()?;
    let (device, descriptor): (Device<UsbCtx>, DeviceDescriptor) = devices
        .iter()
        .filter_map(|d| d.device_descriptor().ok().map(|desc| (d, desc)))
        .find(|(_, desc)| desc.vendor_id() == PRINTER_VID && desc.product_id() == PRINTER_PID_PT_P710BT)?;
    let handle = device.open().ok()?;
    let timeout = Duration::from_millis(100);
    let languages = handle.read_languages(timeout).ok();
    let (manufacturer, product, serial) = if let Some(mut langs) = languages {
        if langs.is_empty() {
            (None, None, None)
        } else {
            let lang = langs.remove(0);
            (
                handle.read_manufacturer_string(lang, &descriptor, timeout).ok(),
                handle.read_product_string(lang, &descriptor, timeout).ok(),
                handle.read_serial_number_string(lang, &descriptor, timeout).ok(),
            )
        }
    } else {
        (None, None, None)
    };
    Some(PrinterInfo {
        vid: PRINTER_VID,
        pid: PRINTER_PID_PT_P710BT,
        manufacturer,
        product,
        serial,
    })
}

async fn health(State(_state): State<AppState>) -> Json<BridgeHealth> {
    let printer = probe_printer();
    Json(BridgeHealth {
        ok: true,
        bridge_up: true,
        printer_connected: printer.is_some(),
        err: None,
    })
}

async fn info(State(state): State<AppState>) -> Json<BridgeInfo> {
    let printer = probe_printer();
    Json(BridgeInfo {
        version: env!("CARGO_PKG_VERSION").to_string(),
        uptime_s: state.start.elapsed().as_secs(),
        printer,
        last_status_hex: None,
    })
}

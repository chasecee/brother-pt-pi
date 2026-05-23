use std::thread;
use std::time::Duration;

use anyhow::{Context, Result};
use clap::Parser;
use ptouch::device::{PrintInfo, PTouchDevice};
use ptouch::render::{Op, Render, RenderConfig};
use ptouch::{Options, PTouch};

#[derive(Parser)]
#[command(about = "Print multiple label PNGs in one USB session with chain cuts")]
struct Args {
    #[arg(long, default_value_t = 0)]
    pad: usize,
    files: Vec<String>,
}

fn connect() -> Result<(PTouch, ptouch::device::Status, ptouch::device::Media)> {
    let opts = Options {
        device: PTouchDevice::PtP710Bt,
        index: 0,
        timeout_milliseconds: 2000,
        no_reset: true,
        usb_no_claim: false,
        usb_no_detach: cfg!(target_os = "macos"),
        no_status_fetch: false,
    };

    for attempt in 0..5 {
        if attempt > 0 {
            thread::sleep(Duration::from_millis(400 * attempt as u64));
        }
        match try_connect(&opts) {
            Ok(v) => return Ok(v),
            Err(e) if attempt + 1 < 5 => {
                eprintln!("connect attempt {} failed: {e:#}", attempt + 1);
            }
            Err(e) => return Err(e),
        }
    }
    unreachable!()
}

fn try_connect(opts: &Options) -> Result<(PTouch, ptouch::device::Status, ptouch::device::Media)> {
    let mut pt = PTouch::new(opts).context("connect printer")?;
    let status = pt.status().context("printer status")?;
    let media = ptouch::device::Media::from((status.media_kind, status.media_width));
    Ok((pt, status, media))
}

fn main() -> Result<()> {
    let args = Args::parse();
    if args.files.is_empty() {
        anyhow::bail!("no images");
    }

    let (mut pt, status, media) = connect()?;

    let rc = RenderConfig {
        y: media.area().1 as usize,
        ..Default::default()
    };

    for (i, file) in args.files.iter().enumerate() {
        let ops = vec![Op::pad(args.pad), Op::image(file), Op::pad(args.pad)];
        let mut r = Render::new(rc.clone());
        r.render(&ops).with_context(|| format!("render {file}"))?;
        let data = r.raster(media.area())?;
        let chain = i + 1 < args.files.len();
        let info = PrintInfo {
            width: Some(status.media_width),
            length: Some(0),
            raster_no: data.len() as u32,
            chain,
            ..Default::default()
        };
        pt.print_raw(data, &info)
            .with_context(|| format!("print {file}"))?;
    }

    Ok(())
}

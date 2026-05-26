use std::thread;
use std::time::Duration;

use anyhow::{Context, Result};
use clap::Parser;
use ptouch::device::{
    Error1, Error2, Media, MediaKind, PrintInfo, PTouchDevice, Status, TapeColour, TextColour,
};
use ptouch::render::{Op, Render, RenderConfig};
use ptouch::{Options, PTouch};
use serde::Serialize;

#[derive(Parser)]
#[command(about = "Print multiple label PNGs in one USB session with chain cuts")]
struct Args {
    #[arg(long, default_value_t = 0)]
    pad: usize,
    #[arg(long, help = "Connect and fetch status to wake the printer")]
    wake: bool,
    #[arg(long, help = "Connect and print status as JSON to stdout")]
    status_json: bool,
    files: Vec<String>,
}

#[derive(Serialize)]
struct StatusJson {
    media_width_mm: u8,
    media_kind: &'static str,
    height_px: usize,
    tape_color: &'static str,
    text_color: &'static str,
    errors: Vec<&'static str>,
    ready: bool,
}

fn connect() -> Result<(PTouch, Status, Media)> {
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

fn try_connect(opts: &Options) -> Result<(PTouch, Status, Media)> {
    let mut pt = PTouch::new(opts).context("connect printer")?;
    let status = pt.status().context("printer status")?;
    let media = Media::from((status.media_kind, status.media_width));
    Ok((pt, status, media))
}

fn media_kind_name(kind: MediaKind) -> &'static str {
    match kind {
        MediaKind::None => "none",
        MediaKind::LaminatedTape => "laminated_tape",
        MediaKind::NonLaminatedTape => "non_laminated_tape",
        MediaKind::HeatShrinkTube => "heat_shrink_tube",
        MediaKind::FlexibleTape => "flexible_tape",
        MediaKind::IncompatibleTape => "incompatible_tape",
    }
}

fn tape_color_name(color: TapeColour) -> &'static str {
    match color {
        TapeColour::White => "white",
        TapeColour::Other => "other",
        TapeColour::ClearBlack => "clear_black",
        TapeColour::Red => "red",
        TapeColour::Blue => "blue",
        TapeColour::Black => "black",
        TapeColour::ClearWhite => "clear_white",
        TapeColour::MatteWhite => "matte_white",
        TapeColour::MatteClear => "matte_clear",
        TapeColour::MatteSilver => "matte_silver",
        TapeColour::SatinGold => "satin_gold",
        TapeColour::SatinSilver => "satin_silver",
        TapeColour::BlueD => "blue_d",
        TapeColour::RedD => "red_d",
        TapeColour::FluroOrange => "fluro_orange",
        TapeColour::FluroYellow => "fluro_yellow",
        TapeColour::BerryPinkS => "berry_pink_s",
        TapeColour::LightGrayS => "light_gray_s",
        TapeColour::LimeGreenS => "lime_green_s",
        TapeColour::YellowF => "yellow_f",
        TapeColour::PinkF => "pink_f",
        TapeColour::BlueF => "blue_f",
        TapeColour::WhiteHst => "white_hst",
        TapeColour::WhiteFlexId => "white_flex_id",
        TapeColour::YellowFlexId => "yellow_flex_id",
        TapeColour::Cleaning => "cleaning",
        TapeColour::Stencil => "stencil",
        TapeColour::Incompatible => "incompatible",
    }
}

fn text_color_name(color: TextColour) -> &'static str {
    match color {
        TextColour::White => "white",
        TextColour::Red => "red",
        TextColour::Blue => "blue",
        TextColour::Black => "black",
        TextColour::Gold => "gold",
        TextColour::BlueF => "blue_f",
        TextColour::Cleaning => "cleaning",
        TextColour::Stencil => "stencil",
        TextColour::Other => "other",
        TextColour::Incompatible => "incompatible",
    }
}

fn collect_errors(error1: Error1, error2: Error2) -> Vec<&'static str> {
    let mut errors = Vec::new();
    if error1.contains(Error1::NO_MEDIA) {
        errors.push("no_media");
    }
    if error1.contains(Error1::CUTTER_JAM) {
        errors.push("cutter_jam");
    }
    if error1.contains(Error1::WEAK_BATT) {
        errors.push("weak_battery");
    }
    if error1.contains(Error1::HIGH_VOLT) {
        errors.push("high_voltage");
    }
    if error2.contains(Error2::WRONG_MEDIA) {
        errors.push("wrong_media");
    }
    if error2.contains(Error2::COVER_OPEN) {
        errors.push("cover_open");
    }
    if error2.contains(Error2::OVERHEAT) {
        errors.push("overheat");
    }
    errors
}

fn status_json(status: &Status, media: &Media) -> StatusJson {
    let errors = collect_errors(status.error1, status.error2);
    let ready = errors.is_empty() && status.media_width > 0;
    StatusJson {
        media_width_mm: status.media_width,
        media_kind: media_kind_name(status.media_kind),
        height_px: media.area().1,
        tape_color: tape_color_name(status.tape_colour),
        text_color: text_color_name(status.text_colour),
        errors,
        ready,
    }
}

fn print_status_json(status: &Status, media: &Media) -> Result<()> {
    let json = status_json(status, media);
    println!("{}", serde_json::to_string(&json)?);
    Ok(())
}

fn main() -> Result<()> {
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("warn")).init();
    let args = Args::parse();
    if args.status_json || args.wake {
        let (_, status, media) = connect()?;
        if args.status_json {
            print_status_json(&status, &media)?;
        } else {
            println!("ready media_width={}", status.media_width);
        }
        return Ok(());
    }
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

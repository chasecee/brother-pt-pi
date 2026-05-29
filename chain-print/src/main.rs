use std::path::PathBuf;

use anyhow::Result;
use chain_print::{print_files, query_status};
use clap::Parser;
use serde_json;

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

fn main() -> Result<()> {
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("warn")).init();
    let args = Args::parse();
    if args.status_json || args.wake {
        let json = query_status()?;
        if args.status_json {
            println!("{}", serde_json::to_string(&json)?);
        } else {
            println!("ready media_width={}", json.media_width_mm);
        }
        return Ok(());
    }
    let paths: Vec<PathBuf> = args.files.iter().map(PathBuf::from).collect();
    print_files(args.pad, &paths)
}

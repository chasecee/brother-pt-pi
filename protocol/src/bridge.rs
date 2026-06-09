use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../src/types/generated/")]
pub struct PrinterInfo {
    pub vid: u16,
    pub pid: u16,
    pub manufacturer: Option<String>,
    pub product: Option<String>,
    pub serial: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../src/types/generated/")]
pub struct BridgeInfo {
    pub version: String,
    pub uptime_s: u64,
    pub printer: Option<PrinterInfo>,
    pub last_status_hex: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../src/types/generated/")]
pub struct BridgeHealth {
    pub ok: bool,
    pub bridge_up: bool,
    pub printer_connected: bool,
    pub err: Option<String>,
}

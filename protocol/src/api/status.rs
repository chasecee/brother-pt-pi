use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../src/types/generated/")]
pub struct StatusResponse {
    pub ok: bool,
    pub printing: bool,
    pub info: String,
    pub err: String,
    pub deployed_at: String,
    pub bridge_up: Option<bool>,
    pub bridge_printer_connected: Option<bool>,
}

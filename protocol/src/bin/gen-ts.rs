use protocol::{api::StatusResponse, bridge::BridgeHealth, bridge::BridgeInfo, bridge::PrinterInfo};
use ts_rs::TS;

fn main() {
    StatusResponse::export_all().unwrap();
    PrinterInfo::export_all().unwrap();
    BridgeInfo::export_all().unwrap();
    BridgeHealth::export_all().unwrap();
}

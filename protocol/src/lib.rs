pub mod api;
pub mod bridge;

pub const PORT_TUNNEL: u16 = 9100;
pub const PORT_ADMIN: u16 = 8080;
pub const STATUS_PACKET_BYTES: usize = 32;
pub const PRINTER_VID: u16 = 0x04F9;
pub const PRINTER_PID_PT_P710BT: u16 = 0x20AF;
pub const MDNS_SERVICE: &str = "_ptlabel-bridge._tcp.local.";

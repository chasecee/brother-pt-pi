use protocol::{
    MDNS_SERVICE, PORT_ADMIN, PORT_TUNNEL, PRINTER_PID_PT_P710BT, PRINTER_VID, STATUS_PACKET_BYTES,
};

fn main() {
    println!("#ifndef PTLABEL_PROTOCOL_H");
    println!("#define PTLABEL_PROTOCOL_H");
    println!();
    println!("#define PTLABEL_PORT_TUNNEL {}", PORT_TUNNEL);
    println!("#define PTLABEL_PORT_ADMIN {}", PORT_ADMIN);
    println!("#define PTLABEL_STATUS_PACKET_BYTES {}", STATUS_PACKET_BYTES);
    println!("#define PTLABEL_PRINTER_VID 0x{:04X}", PRINTER_VID);
    println!(
        "#define PTLABEL_PRINTER_PID_PT_P710BT 0x{:04X}",
        PRINTER_PID_PT_P710BT
    );
    println!("#define PTLABEL_MDNS_SERVICE \"{}\"", MDNS_SERVICE);
    println!();
    println!("#endif");
}

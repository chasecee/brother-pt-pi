# Hardware Reference

## Bridge board

Lonely Binary ESP32-S3 Type-C Development Board (N16R8).

- Module: ESP32-S3-MINI-1 (16 MB flash, 8 MB PSRAM)
- Two USB-C ports: native (right, OTG) and UART (left, CH343)
- No published schematic.

### Critical limitation: no VBUS on native (host) port

The native USB-C port routes D+/D- correctly for USB host mode, but the board does not supply 5 V on VBUS to the connected device. Confirmed by customer feedback on the product page (no jumper for power to the native port). This means USB devices that require host VBUS to bring up their USB peripheral will never enumerate, even with the firmware's USB host stack running correctly.

The PT-P710BT printer falls into this category: it is battery-powered, but its USB interface stays off until it sees VBUS from a host.

### Workarounds

1. USB OTG Y-cable with external 5 V power injection on the host side.
2. Hardware mod: jumper a 5 V rail (e.g. the UART-side 5V) to the native port's VBUS pin. Verify polarity against the ESP32-S3-MINI-1 datasheet.
3. Use a board with a real VBUS power switch, e.g. ESP32-S3-USB-OTG-EV-BOARD (see schematic in this folder). That board exposes `DEV_VBUS_EN` and `IDEV_LIMIT_EN` GPIOs to enable VBUS to the host port via a MIC2005A current-limiter.

### Port roles in this project

- UART port: power input + flash + monitor (CH343, may need WCH driver on macOS).
- Native port: USB host to printer.
- Mac never connects to the bridge for normal operation; everything goes over Wi-Fi via `/health` and `/info` on port 8080, plus TCP printer tunnel on 9100.

## Reference documents

- `esp32-s3-datasheet.pdf`: ESP32-S3 SoC datasheet.
- `esp32-s3-mini-1-datasheet.pdf`: ESP32-S3-MINI-1 module datasheet (the module soldered onto the Lonely Binary board).
- `esp32-s3-usb-otg-schematic.pdf`: Espressif's reference USB-OTG dev board schematic. Use this as the template if hardware-modding the Lonely Binary board for VBUS.

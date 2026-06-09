#pragma once

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#include "esp_err.h"

esp_err_t bridge_usb_host_start(void);
bool bridge_usb_host_started(void);
bool bridge_usb_printer_connected(void);

typedef struct {
    bool seen;
    uint16_t vid;
    uint16_t pid;
    uint8_t addr;
    int last_err;
} bridge_usb_last_seen_t;

void bridge_usb_get_last_seen(bridge_usb_last_seen_t *out);

unsigned bridge_usb_lib_events(void);
unsigned bridge_usb_client_events(void);

esp_err_t bridge_usb_write(const uint8_t *data, size_t len, size_t *written);
esp_err_t bridge_usb_read_status(uint8_t *buf, size_t buf_len, size_t *actual_len);

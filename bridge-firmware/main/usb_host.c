#include "usb_host.h"

#include <stdatomic.h>
#include <string.h>

#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"
#include "freertos/task.h"
#include "usb/usb_helpers.h"
#include "usb/usb_host.h"
#include "usb/usb_types_ch9.h"

#include "protocol.h"
#include "esp_check.h"
#include "esp_log.h"

static const char *TAG = "usb_host";
static atomic_bool s_printer_connected = false;
static atomic_bool s_host_started = false;
static atomic_uint s_last_vidpid = 0;
static atomic_int s_last_err = 0;
static atomic_uint s_last_addr = 0;
static atomic_bool s_last_seen_flag = false;
static atomic_uint s_lib_events = 0;
static atomic_uint s_lib_iters = 0;
static atomic_uint s_client_events = 0;

unsigned bridge_usb_lib_events(void) { return atomic_load(&s_lib_events); }
unsigned bridge_usb_lib_iters(void) { return atomic_load(&s_lib_iters); }
unsigned bridge_usb_client_events(void) { return atomic_load(&s_client_events); }

static void update_last_seen(uint16_t vid, uint16_t pid, uint8_t addr, int err) {
    atomic_store(&s_last_vidpid, ((unsigned)vid << 16) | (unsigned)pid);
    atomic_store(&s_last_addr, addr);
    atomic_store(&s_last_err, err);
    atomic_store(&s_last_seen_flag, true);
}

void bridge_usb_get_last_seen(bridge_usb_last_seen_t *out) {
    if (out == NULL) return;
    out->seen = atomic_load(&s_last_seen_flag);
    unsigned vp = atomic_load(&s_last_vidpid);
    out->vid = (uint16_t)(vp >> 16);
    out->pid = (uint16_t)(vp & 0xffff);
    out->addr = (uint8_t)atomic_load(&s_last_addr);
    out->last_err = atomic_load(&s_last_err);
}
static usb_host_client_handle_t s_client = NULL;
static usb_device_handle_t s_dev = NULL;
static uint8_t s_dev_addr = 0;
static uint8_t s_if_num = 0xff;
static uint8_t s_ep_out = 0;
static uint8_t s_ep_in = 0;
static uint16_t s_ep_in_mps = 64;
static SemaphoreHandle_t s_io_mutex;
static SemaphoreHandle_t s_transfer_done;
static usb_transfer_status_t s_transfer_status = USB_TRANSFER_STATUS_ERROR;
static int s_transfer_actual = 0;

static void transfer_cb(usb_transfer_t *transfer) {
    s_transfer_status = transfer->status;
    s_transfer_actual = transfer->actual_num_bytes;
    BaseType_t high = pdFALSE;
    xSemaphoreGiveFromISR(s_transfer_done, &high);
    if (high == pdTRUE) {
        portYIELD_FROM_ISR();
    }
}

static bool parse_printer_endpoints(
    usb_device_handle_t dev_hdl,
    uint8_t *if_num,
    uint8_t *ep_out,
    uint8_t *ep_in,
    uint16_t *ep_in_mps
) {
    const usb_config_desc_t *cfg = NULL;
    if (usb_host_get_active_config_descriptor(dev_hdl, &cfg) != ESP_OK || cfg == NULL) {
        return false;
    }
    for (uint8_t i = 0; i < 8; i++) {
        int offset = 0;
        const usb_intf_desc_t *intf = usb_parse_interface_descriptor(cfg, i, 0, &offset);
        if (intf == NULL) {
            continue;
        }
        uint8_t out_ep = 0;
        uint8_t in_ep = 0;
        uint16_t in_mps = 64;
        for (int e = 0; e < intf->bNumEndpoints; e++) {
            int ep_offset = offset;
            const usb_ep_desc_t *ep = usb_parse_endpoint_descriptor_by_index(
                intf, e, cfg->wTotalLength, &ep_offset
            );
            if (ep == NULL) {
                continue;
            }
            if ((ep->bmAttributes & USB_BM_ATTRIBUTES_XFERTYPE_MASK) != USB_BM_ATTRIBUTES_XFER_BULK) {
                continue;
            }
            if (USB_EP_DESC_GET_EP_DIR(ep) == 1) {
                in_ep = ep->bEndpointAddress;
                in_mps = USB_EP_DESC_GET_MPS(ep);
            } else {
                out_ep = ep->bEndpointAddress;
            }
        }
        if (in_ep != 0 && out_ep != 0) {
            *if_num = intf->bInterfaceNumber;
            *ep_out = out_ep;
            *ep_in = in_ep;
            *ep_in_mps = in_mps;
            return true;
        }
    }
    return false;
}

static esp_err_t connect_device(uint8_t dev_addr) {
    if (s_dev != NULL) {
        return ESP_OK;
    }
    usb_device_handle_t dev_hdl = NULL;
    ESP_RETURN_ON_ERROR(usb_host_device_open(s_client, dev_addr, &dev_hdl), TAG, "open device");

    const usb_device_desc_t *dev_desc = NULL;
    ESP_RETURN_ON_ERROR(usb_host_get_device_descriptor(dev_hdl, &dev_desc), TAG, "get device desc");
    ESP_LOGI(TAG, "device seen addr=%u vid=0x%04x pid=0x%04x", dev_addr, dev_desc->idVendor, dev_desc->idProduct);
    update_last_seen(dev_desc->idVendor, dev_desc->idProduct, dev_addr, 0);
    if (dev_desc->idVendor != PTLABEL_PRINTER_VID || dev_desc->idProduct != PTLABEL_PRINTER_PID_PT_P710BT) {
        update_last_seen(dev_desc->idVendor, dev_desc->idProduct, dev_addr, ESP_ERR_NOT_SUPPORTED);
        usb_host_device_close(s_client, dev_hdl);
        return ESP_ERR_NOT_SUPPORTED;
    }

    uint8_t if_num = 0xff;
    uint8_t ep_out = 0;
    uint8_t ep_in = 0;
    uint16_t ep_in_mps = 64;
    if (!parse_printer_endpoints(dev_hdl, &if_num, &ep_out, &ep_in, &ep_in_mps)) {
        usb_host_device_close(s_client, dev_hdl);
        return ESP_ERR_NOT_FOUND;
    }
    ESP_RETURN_ON_ERROR(
        usb_host_interface_claim(s_client, dev_hdl, if_num, 0),
        TAG,
        "claim interface"
    );

    s_dev = dev_hdl;
    s_dev_addr = dev_addr;
    s_if_num = if_num;
    s_ep_out = ep_out;
    s_ep_in = ep_in;
    s_ep_in_mps = ep_in_mps;
    atomic_store(&s_printer_connected, true);
    ESP_LOGI(TAG, "printer connected addr=%u if=%u out=0x%02x in=0x%02x mps=%u", s_dev_addr, s_if_num, s_ep_out, s_ep_in, s_ep_in_mps);
    return ESP_OK;
}

static void disconnect_device(void) {
    if (s_dev == NULL) {
        atomic_store(&s_printer_connected, false);
        return;
    }
    usb_host_interface_release(s_client, s_dev, s_if_num);
    usb_host_device_close(s_client, s_dev);
    s_dev = NULL;
    s_dev_addr = 0;
    s_if_num = 0xff;
    s_ep_out = 0;
    s_ep_in = 0;
    s_ep_in_mps = 64;
    atomic_store(&s_printer_connected, false);
    ESP_LOGI(TAG, "printer disconnected");
}

static void client_event_cb(const usb_host_client_event_msg_t *event_msg, void *arg) {
    (void)arg;
    atomic_fetch_add(&s_client_events, 1);
    if (event_msg->event == USB_HOST_CLIENT_EVENT_NEW_DEV) {
        (void)connect_device(event_msg->new_dev.address);
    } else if (event_msg->event == USB_HOST_CLIENT_EVENT_DEV_GONE) {
        if (event_msg->dev_gone.dev_hdl == s_dev) {
            disconnect_device();
        }
    }
}

static void usb_lib_task(void *arg) {
    (void)arg;
    while (1) {
        uint32_t flags = 0;
        esp_err_t r = usb_host_lib_handle_events(pdMS_TO_TICKS(1000), &flags);
        atomic_fetch_add(&s_lib_iters, 1);
        if (r == ESP_OK) {
            atomic_fetch_add(&s_lib_events, 1);
        }
    }
}

static void usb_client_task(void *arg) {
    (void)arg;
    while (1) {
        usb_host_client_handle_events(s_client, portMAX_DELAY);
    }
}

static esp_err_t submit_transfer_wait(usb_transfer_t *transfer, bool control) {
    s_transfer_status = USB_TRANSFER_STATUS_ERROR;
    s_transfer_actual = 0;
    if (xSemaphoreTake(s_transfer_done, 0) == pdTRUE) {
    }
    esp_err_t err = control
        ? usb_host_transfer_submit_control(s_client, transfer)
        : usb_host_transfer_submit(transfer);
    if (err != ESP_OK) {
        return err;
    }
    if (xSemaphoreTake(s_transfer_done, pdMS_TO_TICKS(3000)) != pdTRUE) {
        return ESP_ERR_TIMEOUT;
    }
    if (s_transfer_status != USB_TRANSFER_STATUS_COMPLETED) {
        return ESP_FAIL;
    }
    return ESP_OK;
}

esp_err_t bridge_usb_host_start(void) {
    if (atomic_load(&s_host_started)) {
        return ESP_OK;
    }
    s_io_mutex = xSemaphoreCreateMutex();
    s_transfer_done = xSemaphoreCreateBinary();
    if (s_io_mutex == NULL || s_transfer_done == NULL) {
        return ESP_ERR_NO_MEM;
    }
    const usb_host_config_t host_config = {
        .skip_phy_setup = false,
        .root_port_unpowered = false,
        .intr_flags = ESP_INTR_FLAG_LEVEL1,
    };
    ESP_RETURN_ON_ERROR(usb_host_install(&host_config), TAG, "usb_host_install");

    const usb_host_client_config_t client_config = {
        .is_synchronous = false,
        .max_num_event_msg = 5,
        .async = {
            .client_event_callback = client_event_cb,
            .callback_arg = NULL,
        },
    };
    ESP_RETURN_ON_ERROR(usb_host_client_register(&client_config, &s_client), TAG, "client register");
    xTaskCreate(usb_lib_task, "usb_lib", 4096, NULL, 10, NULL);
    xTaskCreate(usb_client_task, "usb_client", 4096, NULL, 10, NULL);
    atomic_store(&s_printer_connected, false);
    atomic_store(&s_host_started, true);
    ESP_LOGI(TAG, "usb host initialized");
    return ESP_OK;
}

bool bridge_usb_host_started(void) {
    return atomic_load(&s_host_started);
}

bool bridge_usb_printer_connected(void) {
    return atomic_load(&s_printer_connected);
}

esp_err_t bridge_usb_write(const uint8_t *data, size_t len, size_t *written) {
    if (written) {
        *written = 0;
    }
    if (data == NULL || len == 0) {
        return ESP_ERR_INVALID_ARG;
    }
    if (!atomic_load(&s_host_started) || s_dev == NULL || s_ep_out == 0) {
        return ESP_ERR_INVALID_STATE;
    }
    if (xSemaphoreTake(s_io_mutex, pdMS_TO_TICKS(2000)) != pdTRUE) {
        return ESP_ERR_TIMEOUT;
    }
    usb_transfer_t *transfer = NULL;
    esp_err_t err = usb_host_transfer_alloc(len, 0, &transfer);
    if (err == ESP_OK) {
        memcpy(transfer->data_buffer, data, len);
        transfer->device_handle = s_dev;
        transfer->bEndpointAddress = s_ep_out;
        transfer->num_bytes = len;
        transfer->timeout_ms = 1000;
        transfer->callback = transfer_cb;
        transfer->context = NULL;
        err = submit_transfer_wait(transfer, false);
        if (err == ESP_OK && written) {
            *written = (size_t)s_transfer_actual;
        }
    }
    if (transfer) {
        usb_host_transfer_free(transfer);
    }
    xSemaphoreGive(s_io_mutex);
    return err;
}

esp_err_t bridge_usb_read_status(uint8_t *buf, size_t buf_len, size_t *actual_len) {
    if (actual_len) {
        *actual_len = 0;
    }
    if (buf == NULL || buf_len < PTLABEL_STATUS_PACKET_BYTES) {
        return ESP_ERR_INVALID_ARG;
    }
    if (!atomic_load(&s_host_started) || s_dev == NULL || s_ep_in == 0) {
        return ESP_ERR_INVALID_STATE;
    }
    if (xSemaphoreTake(s_io_mutex, pdMS_TO_TICKS(3000)) != pdTRUE) {
        return ESP_ERR_TIMEOUT;
    }
    size_t request_len = s_ep_in_mps;
    if (request_len < PTLABEL_STATUS_PACKET_BYTES) {
        request_len = PTLABEL_STATUS_PACKET_BYTES;
    }
    usb_transfer_t *transfer = NULL;
    esp_err_t err = usb_host_transfer_alloc(request_len, 0, &transfer);
    if (err == ESP_OK) {
        transfer->device_handle = s_dev;
        transfer->bEndpointAddress = s_ep_in;
        transfer->num_bytes = request_len;
        transfer->timeout_ms = 1500;
        transfer->callback = transfer_cb;
        transfer->context = NULL;
        err = submit_transfer_wait(transfer, false);
        if (err == ESP_OK) {
            size_t copied = s_transfer_actual > (int)buf_len ? buf_len : (size_t)s_transfer_actual;
            memcpy(buf, transfer->data_buffer, copied);
            if (actual_len) {
                *actual_len = copied;
            }
        }
    }
    if (transfer) {
        usb_host_transfer_free(transfer);
    }
    xSemaphoreGive(s_io_mutex);
    return err;
}

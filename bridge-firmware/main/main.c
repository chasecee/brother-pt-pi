#include <stdatomic.h>
#include <stdbool.h>

#include "esp_check.h"
#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "nvs_flash.h"

#include "app_state.h"
#include "http_admin.h"
#include "led.h"
#include "log_sink.h"
#include "tcp_proxy.h"
#include "usb_host.h"
#include "wifi.h"

static const char *TAG = "ptlabel_bridge";

static atomic_bool s_wifi_ready = false;
static atomic_bool s_transfer_active = false;

void bridge_set_wifi_ready(bool ready) {
    atomic_store(&s_wifi_ready, ready);
}

bool bridge_wifi_ready(void) {
    return atomic_load(&s_wifi_ready);
}

void bridge_set_transfer_active(bool active) {
    atomic_store(&s_transfer_active, active);
}

bool bridge_transfer_active(void) {
    return atomic_load(&s_transfer_active);
}

void app_main(void) {
    ESP_ERROR_CHECK(nvs_flash_init());
    ESP_ERROR_CHECK(bridge_led_init());
    ESP_ERROR_CHECK(bridge_log_sink_start());
    ESP_ERROR_CHECK(bridge_wifi_start());
    ESP_ERROR_CHECK(bridge_http_admin_start());
    ESP_ERROR_CHECK(bridge_tcp_proxy_start());
#if CONFIG_BRIDGE_USB_AUTOSTART
    ESP_ERROR_CHECK(bridge_usb_host_start());
#endif

    ESP_LOGI(TAG, "bridge firmware started");
    while (1) {
        bridge_led_tick();
        vTaskDelay(pdMS_TO_TICKS(100));
    }
}

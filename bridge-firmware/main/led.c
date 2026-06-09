#include "led.h"

#include <stdbool.h>
#include <stdint.h>

#include "driver/gpio.h"

#include "app_state.h"
#include "usb_host.h"

static bool s_led = false;
static uint32_t s_tick = 0;
static const int BRIDGE_LED_GPIO = 48;

esp_err_t bridge_led_init(void) {
    gpio_config_t cfg = {
        .pin_bit_mask = 1ULL << BRIDGE_LED_GPIO,
        .mode = GPIO_MODE_OUTPUT,
        .pull_up_en = GPIO_PULLUP_DISABLE,
        .pull_down_en = GPIO_PULLDOWN_DISABLE,
        .intr_type = GPIO_INTR_DISABLE,
    };
    gpio_config(&cfg);
    gpio_set_level(BRIDGE_LED_GPIO, 0);
    return ESP_OK;
}

void bridge_led_tick(void) {
    s_tick++;
    uint32_t period = 8;
    if (bridge_transfer_active()) {
        period = 2;
    } else if (bridge_usb_printer_connected()) {
        period = 4;
    } else if (bridge_wifi_ready()) {
        gpio_set_level(BRIDGE_LED_GPIO, 1);
        return;
    }
    if ((s_tick % period) == 0) {
        s_led = !s_led;
        gpio_set_level(BRIDGE_LED_GPIO, s_led ? 1 : 0);
    }
}

#pragma once

#include "esp_err.h"

esp_err_t bridge_log_sink_start(void);
void bridge_log_sink_notify_netif_up(void);

#pragma once

#include <stdbool.h>

void bridge_set_wifi_ready(bool ready);
bool bridge_wifi_ready(void);
void bridge_set_transfer_active(bool active);
bool bridge_transfer_active(void);

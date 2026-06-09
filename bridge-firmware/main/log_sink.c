#include "log_sink.h"

#include <stdarg.h>
#include <stdatomic.h>
#include <stdio.h>
#include <string.h>

#include <lwip/sockets.h>
#include <lwip/netdb.h>

#include "esp_log.h"
#include "esp_netif.h"

static atomic_int s_sock = -1;
static atomic_bool s_netif_up = false;
static vprintf_like_t s_prev_vprintf = NULL;
static struct sockaddr_in s_bcast = {0};

static int udp_vprintf(const char *fmt, va_list args) {
    char buf[512];
    va_list copy;
    va_copy(copy, args);
    int n = vsnprintf(buf, sizeof(buf), fmt, copy);
    va_end(copy);
    if (n > 0 && atomic_load(&s_netif_up)) {
        int sock = atomic_load(&s_sock);
        if (sock >= 0) {
            int send_len = n < (int)sizeof(buf) ? n : (int)sizeof(buf);
            sendto(sock, buf, send_len, 0, (struct sockaddr *)&s_bcast, sizeof(s_bcast));
        }
    }
    if (s_prev_vprintf) {
        return s_prev_vprintf(fmt, args);
    }
    return vprintf(fmt, args);
}

esp_err_t bridge_log_sink_start(void) {
    int sock = socket(AF_INET, SOCK_DGRAM, IPPROTO_UDP);
    if (sock < 0) {
        return ESP_FAIL;
    }
    int yes = 1;
    setsockopt(sock, SOL_SOCKET, SO_BROADCAST, &yes, sizeof(yes));
    s_bcast.sin_family = AF_INET;
    s_bcast.sin_port = htons(CONFIG_BRIDGE_LOG_UDP_PORT);
    s_bcast.sin_addr.s_addr = htonl(INADDR_BROADCAST);
    atomic_store(&s_sock, sock);
    s_prev_vprintf = esp_log_set_vprintf(udp_vprintf);
    return ESP_OK;
}

void bridge_log_sink_notify_netif_up(void) {
    esp_netif_t *netif = esp_netif_get_handle_from_ifkey("WIFI_STA_DEF");
    esp_netif_ip_info_t ip = {0};
    if (netif && esp_netif_get_ip_info(netif, &ip) == ESP_OK && ip.ip.addr != 0) {
        uint32_t bcast = ip.ip.addr | ~ip.netmask.addr;
        s_bcast.sin_addr.s_addr = bcast;
    }
    atomic_store(&s_netif_up, true);
}

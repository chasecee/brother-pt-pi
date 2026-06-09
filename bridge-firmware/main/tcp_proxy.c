#include "tcp_proxy.h"

#include <string.h>
#include <unistd.h>
#include <sys/socket.h>
#include <sys/types.h>
#include <netinet/in.h>

#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

#include "app_state.h"
#include "protocol.h"
#include "usb_host.h"

static const char *TAG = "tcp_proxy";
static const uint8_t STATUS_REQ[3] = {0x1b, 0x69, 0x53};

static void tcp_server_task(void *arg) {
    int server_fd = socket(AF_INET, SOCK_STREAM, IPPROTO_IP);
    if (server_fd < 0) {
        ESP_LOGE(TAG, "socket failed");
        vTaskDelete(NULL);
        return;
    }
    struct sockaddr_in addr = {0};
    addr.sin_family = AF_INET;
    addr.sin_port = htons(PTLABEL_PORT_TUNNEL);
    addr.sin_addr.s_addr = htonl(INADDR_ANY);
    if (bind(server_fd, (struct sockaddr *)&addr, sizeof(addr)) != 0) {
        ESP_LOGE(TAG, "bind failed");
        close(server_fd);
        vTaskDelete(NULL);
        return;
    }
    if (listen(server_fd, 1) != 0) {
        ESP_LOGE(TAG, "listen failed");
        close(server_fd);
        vTaskDelete(NULL);
        return;
    }
    ESP_LOGI(TAG, "listening on %d", PTLABEL_PORT_TUNNEL);
    while (1) {
        int client_fd = accept(server_fd, NULL, NULL);
        if (client_fd < 0) {
            continue;
        }
        bridge_set_transfer_active(true);
        uint8_t buf[256];
        while (1) {
            int n = recv(client_fd, buf, sizeof(buf), 0);
            if (n <= 0) {
                break;
            }
            size_t written = 0;
            if (bridge_usb_write(buf, (size_t)n, &written) != ESP_OK || written != (size_t)n) {
                ESP_LOGW(TAG, "usb write failed");
                break;
            }
            int status_req_count = 0;
            for (int i = 0; i + 2 < n; i++) {
                if (buf[i] == STATUS_REQ[0] && buf[i + 1] == STATUS_REQ[1] && buf[i + 2] == STATUS_REQ[2]) {
                    status_req_count++;
                }
            }
            for (int i = 0; i < status_req_count; i++) {
                uint8_t status_buf[PTLABEL_STATUS_PACKET_BYTES];
                size_t actual = 0;
                if (bridge_usb_read_status(status_buf, sizeof(status_buf), &actual) != ESP_OK || actual == 0) {
                    ESP_LOGW(TAG, "usb status read failed");
                    break;
                }
                if (send(client_fd, status_buf, actual, 0) < 0) {
                    ESP_LOGW(TAG, "socket send failed");
                    break;
                }
            }
        }
        bridge_set_transfer_active(false);
        close(client_fd);
    }
}

esp_err_t bridge_tcp_proxy_start(void) {
    xTaskCreate(tcp_server_task, "tcp_proxy", 4096, NULL, 5, NULL);
    return ESP_OK;
}

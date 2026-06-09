#include "http_admin.h"

#include <stdio.h>
#include <string.h>

#include "esp_app_desc.h"
#include "esp_http_server.h"
#include "esp_log.h"
#include "esp_ota_ops.h"
#include "esp_partition.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

#include "app_state.h"
#include "protocol.h"
#include "usb_host.h"

static const char *TAG = "http_admin";
static uint64_t s_started_us = 0;

static esp_err_t send_json(httpd_req_t *req, const char *body, int n) {
    httpd_resp_set_type(req, "application/json");
    return httpd_resp_send(req, body, n);
}

static esp_err_t health_handler(httpd_req_t *req) {
    char body[192];
    int n = snprintf(
        body, sizeof(body),
        "{\"ok\":true,\"bridge_up\":true,\"usb_started\":%s,\"printer_connected\":%s,\"err\":null}",
        bridge_usb_host_started() ? "true" : "false",
        bridge_usb_printer_connected() ? "true" : "false"
    );
    return send_json(req, body, n);
}

static esp_err_t info_handler(httpd_req_t *req) {
    uint64_t uptime_s = (esp_timer_get_time() - s_started_us) / 1000000ULL;
    bridge_usb_last_seen_t seen = {0};
    bridge_usb_get_last_seen(&seen);
    const esp_app_desc_t *app = esp_app_get_description();
    const esp_partition_t *running = esp_ota_get_running_partition();
    char body[512];
    int n;
    const char *common_fmt =
        "{\"version\":\"%s\",\"uptime_s\":%llu,\"usb_started\":%s,\"connected\":%s,"
        "\"lib_events\":%u,\"client_events\":%u,\"partition\":\"%s\"";
    n = snprintf(
        body, sizeof(body), common_fmt,
        app ? app->version : "0.0.0",
        (unsigned long long)uptime_s,
        bridge_usb_host_started() ? "true" : "false",
        bridge_usb_printer_connected() ? "true" : "false",
        bridge_usb_lib_events(), bridge_usb_client_events(),
        running ? running->label : "?"
    );
    if (seen.seen) {
        n += snprintf(
            body + n, sizeof(body) - n,
            ",\"last_seen\":{\"vid\":\"0x%04x\",\"pid\":\"0x%04x\",\"addr\":%u,\"err\":%d}}",
            seen.vid, seen.pid, seen.addr, seen.last_err
        );
    } else {
        n += snprintf(body + n, sizeof(body) - n, ",\"last_seen\":null}");
    }
    return send_json(req, body, n);
}

static esp_err_t usb_enable_handler(httpd_req_t *req) {
    esp_err_t err = bridge_usb_host_start();
    char body[128];
    int n = snprintf(
        body, sizeof(body),
        "{\"ok\":%s,\"usb_started\":%s,\"err\":%d}",
        err == ESP_OK ? "true" : "false",
        bridge_usb_host_started() ? "true" : "false",
        err
    );
    return send_json(req, body, n);
}

static void deferred_restart_task(void *arg) {
    (void)arg;
    vTaskDelay(pdMS_TO_TICKS(500));
    esp_restart();
}

static esp_err_t ota_handler(httpd_req_t *req) {
    const esp_partition_t *target = esp_ota_get_next_update_partition(NULL);
    if (target == NULL) {
        httpd_resp_send_err(req, HTTPD_500_INTERNAL_SERVER_ERROR, "no ota partition");
        return ESP_FAIL;
    }
    ESP_LOGI(TAG, "ota begin -> %s (%lu bytes)", target->label, (unsigned long)req->content_len);
    esp_ota_handle_t handle = 0;
    if (esp_ota_begin(target, OTA_WITH_SEQUENTIAL_WRITES, &handle) != ESP_OK) {
        httpd_resp_send_err(req, HTTPD_500_INTERNAL_SERVER_ERROR, "ota begin failed");
        return ESP_FAIL;
    }
    char buf[4096];
    int remaining = req->content_len;
    size_t total = 0;
    while (remaining > 0) {
        int chunk = remaining < (int)sizeof(buf) ? remaining : (int)sizeof(buf);
        int got = httpd_req_recv(req, buf, chunk);
        if (got <= 0) {
            esp_ota_abort(handle);
            httpd_resp_send_err(req, HTTPD_500_INTERNAL_SERVER_ERROR, "recv failed");
            return ESP_FAIL;
        }
        if (esp_ota_write(handle, buf, got) != ESP_OK) {
            esp_ota_abort(handle);
            httpd_resp_send_err(req, HTTPD_500_INTERNAL_SERVER_ERROR, "ota write failed");
            return ESP_FAIL;
        }
        total += got;
        remaining -= got;
    }
    if (esp_ota_end(handle) != ESP_OK) {
        httpd_resp_send_err(req, HTTPD_500_INTERNAL_SERVER_ERROR, "ota end failed");
        return ESP_FAIL;
    }
    if (esp_ota_set_boot_partition(target) != ESP_OK) {
        httpd_resp_send_err(req, HTTPD_500_INTERNAL_SERVER_ERROR, "set boot failed");
        return ESP_FAIL;
    }
    char body[128];
    int n = snprintf(body, sizeof(body), "{\"ok\":true,\"written\":%u,\"boot\":\"%s\"}", (unsigned)total, target->label);
    send_json(req, body, n);
    ESP_LOGI(TAG, "ota complete, restarting");
    xTaskCreate(deferred_restart_task, "restart", 2048, NULL, 5, NULL);
    return ESP_OK;
}

static esp_err_t reboot_handler(httpd_req_t *req) {
    send_json(req, "{\"ok\":true}", 11);
    xTaskCreate(deferred_restart_task, "restart", 2048, NULL, 5, NULL);
    return ESP_OK;
}

esp_err_t bridge_http_admin_start(void) {
    httpd_config_t config = HTTPD_DEFAULT_CONFIG();
    config.server_port = PTLABEL_PORT_ADMIN;
    config.recv_wait_timeout = 30;
    config.send_wait_timeout = 30;
    httpd_handle_t server = NULL;
    if (httpd_start(&server, &config) != ESP_OK) {
        ESP_LOGE(TAG, "httpd_start failed");
        return ESP_FAIL;
    }
    s_started_us = esp_timer_get_time();
    static const httpd_uri_t routes[] = {
        {.uri = "/health", .method = HTTP_GET, .handler = health_handler},
        {.uri = "/info", .method = HTTP_GET, .handler = info_handler},
        {.uri = "/usb/enable", .method = HTTP_POST, .handler = usb_enable_handler},
        {.uri = "/ota", .method = HTTP_POST, .handler = ota_handler},
        {.uri = "/reboot", .method = HTTP_POST, .handler = reboot_handler},
    };
    for (size_t i = 0; i < sizeof(routes) / sizeof(routes[0]); i++) {
        httpd_register_uri_handler(server, &routes[i]);
    }
    ESP_LOGI(TAG, "http admin on %d", PTLABEL_PORT_ADMIN);
    return ESP_OK;
}

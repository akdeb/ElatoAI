#include "OTA.h"
#include "HttpsOTAUpdate.h"

// OTA firmware url
#ifdef TOUCH_MODE
static const char *ota_firmware_url = "<YOUR S3 OTA FIRMWARE URL HERE> - TOUCH MODE";
#else
static const char *ota_firmware_url = "<YOUR S3 OTA FIRMWARE URL HERE> - BUTTON MODE";
#endif

static const char *server_certificate = R"EOF(
-----BEGIN CERTIFICATE-----

    <YOUR S3 HOST CERTIFICATE HERE>

-----END CERTIFICATE-----
)EOF";

void markOTAUpdateComplete() {
    HTTPClient http;
    // Construct the JSON payload
    JsonDocument doc;
    doc["authToken"] = authTokenGlobal;
    
    String jsonString;
    serializeJson(doc, jsonString);

    // Initialize HTTPS connection with client
    #ifdef DEV_MODE
        http.begin("http://" + String(backend_server) + ":" + String(backend_port) + "/api/ota_update_handler");
    #else
        WiFiClientSecure client;
        client.setCACert(Vercel_CA_cert);  // Using the existing server certificate
        http.begin(client, "https://" + String(backend_server) + "/api/ota_update_handler");
    #endif

    http.addHeader("Content-Type", "application/json");
    http.setTimeout(10000);  // Add timeout for reliability
    
    // Make the POST request
    int httpCode = http.POST(jsonString);
    
    // ... existing code ...
    if (httpCode > 0) {
        if (httpCode == HTTP_CODE_OK) {
            Serial.println("OTA status updated successfully");
            setOTAStatusInNVS(OTA_IDLE);
        } else {
            Serial.printf("OTA status update failed with code: %d\n", httpCode);
        }
    } else {
        Serial.printf("HTTP request failed: %s\n", http.errorToString(httpCode).c_str());
    }
    
    http.end();
}

void getOTAStatusFromNVS()
{
    preferences.begin("ota", false);
    otaState = (OtaStatus)preferences.getUInt("status", OTA_IDLE);
    preferences.end();
}

void setOTAStatusInNVS(OtaStatus status)
{
    preferences.begin("ota", false);
    preferences.putUInt("status", status);
    preferences.end();
    otaState = status;
}

void loopOTA()
{
    HttpsOTAStatus_t otastatus = HttpsOTA.status();
    if (otastatus == HTTPS_OTA_SUCCESS)
    {
        Serial.println("Firmware written successfully. To reboot device, call API ESP.restart() or PUSH restart button on device");
        setOTAStatusInNVS(OTA_COMPLETE);
        ESP.restart();
    }
    else if (otastatus == HTTPS_OTA_FAIL)
    {
        Serial.println("Firmware Upgrade Fail");
        setOTAStatusInNVS(OTA_IN_PROGRESS);
        ESP.restart();
    }
}

void HttpEvent(HttpEvent_t *event)
{
    switch (event->event_id)
    {
    case HTTP_EVENT_ERROR:
        // Serial.println("Http Event Error");
        break;
    case HTTP_EVENT_ON_CONNECTED:
        // Serial.println("Http Event On Connected");
        break;
    case HTTP_EVENT_HEADER_SENT:
        // Serial.println("Http Event Header Sent");
        break;
    case HTTP_EVENT_ON_HEADER:
        // Serial.printf("Http Event On Header, key=%s, value=%s\n", event->header_key, event->header_value);
        break;
    case HTTP_EVENT_ON_DATA:
        break;
    case HTTP_EVENT_ON_FINISH:
        // Serial.println("Http Event On Finish");
        break;
    case HTTP_EVENT_DISCONNECTED:
        // Serial.println("Http Event Disconnected");
        break;
    }
}

void performOTAUpdate()
{
    Serial.println("Starting OTA Update...");
    HttpsOTA.onHttpEvent(HttpEvent);
    HttpsOTA.begin(ota_firmware_url, server_certificate);
}

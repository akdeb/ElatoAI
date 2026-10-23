#include "Battery.h"
#include "Config.h"
#include <Wire.h>
#include <WiFi.h>
#include <driver/gpio.h>

namespace {
constexpr int SDA_PIN = 18;
constexpr int SCL_PIN = 17;
constexpr uint8_t GAUGE_ADDRESS = 0x36;
constexpr uint32_t SAMPLE_INTERVAL_MS = 60000;
constexpr uint32_t SYNC_INTERVAL_MS = 300000;
constexpr uint32_t RETRY_INTERVAL_MS = 60000;
SemaphoreHandle_t busMutex = nullptr;
bool busStarted = false;

struct Reading {
  float percent;
  int millivolts;
  uint32_t sampledAt;
};

bool readWord(uint8_t reg, uint16_t &value) {
  Wire.beginTransmission(GAUGE_ADDRESS);
  Wire.write(reg);
  if (Wire.endTransmission(false) != 0) return false;
  if (Wire.requestFrom(GAUGE_ADDRESS, uint8_t(2)) != 2) return false;
  value = uint16_t(Wire.read()) << 8;
  value |= uint16_t(Wire.read());
  return true;
}

bool sampleBattery(Reading &reading) {
  xSemaphoreTake(busMutex, portMAX_DELAY);
  if (shutdownInProgress || !busStarted) {
    xSemaphoreGive(busMutex);
    return false;
  }
  uint16_t voltage = 0, soc = 0;
  // Datasheet: VCELL (0x02) = 78.125 uV/LSB, SOC (0x04) = 1/256 %/LSB.
  // Only read registers: never reset or quick-start the gauge on ESP wake.
  bool ok = readWord(0x02, voltage) && readWord(0x04, soc);
  xSemaphoreGive(busMutex);
  float millivolts = voltage * 0.078125f;
  if (!ok || millivolts < 2500 || millivolts > 4500) {
    Serial.println("[Battery] MAX17048 read failed; no new reading uploaded");
    return false;
  }
  reading = {min(100.0f, soc / 256.0f), int(millivolts + 0.5f), millis()};
  Serial.printf("[Battery] %.1f%%, %d mV\n", reading.percent, reading.millivolts);
  return true;
}

bool syncBattery(const Reading &reading) {
  if (shutdownInProgress) return false;
  HTTPClient http;
  // Keep the TLS client alive until http.end(), including in production builds.
  WiFiClientSecure client;
#ifdef DEV_MODE
  String url = "http://" + String(backend_server) + ":" + String(backend_port);
  if (!http.begin(url + "/api/device/battery")) return false;
#else
  client.setCACert(Vercel_CA_cert);
  if (!http.begin(client, "https://" + String(backend_server) + "/api/device/battery")) return false;
#endif
  http.setConnectTimeout(5000);
  http.setTimeout(5000);
  http.addHeader("Authorization", "Bearer " + authTokenGlobal);
  http.addHeader("Content-Type", "application/json");
  JsonDocument doc;
  doc["mac_address"] = WiFi.macAddress();
  doc["battery_percent"] = reading.percent;
  doc["battery_voltage_mv"] = reading.millivolts;
  String payload;
  serializeJson(doc, payload);
  int status = http.POST(payload);
  http.end();
  Serial.printf("[Battery] sync HTTP %d\n", status);
  return status == HTTP_CODE_OK;
}

void batteryTask(void *) {
  // The first SOC result is available about one second after gauge power-on.
  vTaskDelay(pdMS_TO_TICKS(1500));
  Reading cached{};
  bool valid = false, sampled = false, attemptedSync = false;
  uint32_t lastSample = 0, lastAttempt = 0;
  uint32_t syncDelay = RETRY_INTERVAL_MS;
  for (;;) {
    if (shutdownInProgress) {
      vTaskDelete(nullptr);
      return;
    }
    uint32_t now = millis();
    if (!sampled || now - lastSample >= SAMPLE_INTERVAL_MS) {
      sampled = true;
      lastSample = now;
      valid = sampleBattery(cached);
    }
    if (valid && millis() - cached.sampledAt < SAMPLE_INTERVAL_MS &&
        WiFi.status() == WL_CONNECTED && !authTokenGlobal.isEmpty() &&
        otaState == OTA_IDLE &&
        (!attemptedSync || now - lastAttempt >= syncDelay)) {
      attemptedSync = true;
      lastAttempt = now;
      syncDelay = syncBattery(cached) ? SYNC_INTERVAL_MS : RETRY_INTERVAL_MS;
    }
    vTaskDelay(pdMS_TO_TICKS(1000));
  }
}
} // namespace

void setupBattery() {
  busMutex = xSemaphoreCreateMutex();
  if (!busMutex) return;
  busStarted = Wire.begin(SDA_PIN, SCL_PIN, 100000);
  Wire.setTimeOut(50);
  if (!busStarted) {
    Serial.println("[Battery] I2C initialization failed");
    return;
  }
  // Separate low priority task: HTTPS never blocks the audio/WebSocket loop.
  if (xTaskCreate(batteryTask, "Battery", 8192, nullptr, 1, nullptr) != pdPASS) {
    Serial.println("[Battery] Could not start battery task");
  }
}

void prepareBatteryForSleep() {
  if (!busMutex) return;
  xSemaphoreTake(busMutex, portMAX_DELAY);
  if (busStarted) Wire.end();
  busStarted = false;
  // Release both lines to the external pull-ups. Leave the gauge tracking the
  // cell using its automatic hibernate mode while the ESP32 is asleep.
  gpio_set_direction(gpio_num_t(SDA_PIN), GPIO_MODE_INPUT);
  gpio_set_direction(gpio_num_t(SCL_PIN), GPIO_MODE_INPUT);
  gpio_set_pull_mode(gpio_num_t(SDA_PIN), GPIO_FLOATING);
  gpio_set_pull_mode(gpio_num_t(SCL_PIN), GPIO_FLOATING);
  xSemaphoreGive(busMutex);
}

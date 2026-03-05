#include <WiFi.h>
#include "time.h"
#include "esp_sleep.h"

// ====== WiFi credentials ======
const char* WIFI_SSID = "556_2.4G";
const char* WIFI_PASS = "14141414";

// ====== Your LED pins ======
const int BLUE_LED_PIN  = 13;
const int RED_LED_PIN   = 9;
const int GREEN_LED_PIN = 8;

// ====== Schedule ======
static const int TARGET_HOUR   = 00;  // 11:15 local time
static const int TARGET_MINUTE = 10;

// Blink settings
static const uint32_t BLINK_DURATION_MS = 30 * 1000; // blink for 30 seconds
static const uint32_t BLINK_PERIOD_MS   = 500;       // 0.5s on/off

// ICT timezone (UTC+7) without DST
// This sets localtime() correctly.
static const char* TZ_ICT = "ICT-7"; // POSIX TZ format: "STDoffset" where offset is *west* of UTC.
// "ICT-7" corresponds to UTC+7.

void setAllLeds(bool on) {
  digitalWrite(RED_LED_PIN,   on ? HIGH : LOW);
  digitalWrite(GREEN_LED_PIN, on ? HIGH : LOW);
  digitalWrite(BLUE_LED_PIN,  on ? HIGH : LOW);
}

bool syncTimeWithNTP(uint32_t timeoutMs = 20000) {
  // Use NTP pool; you can replace with a closer server if you want.
  configTzTime(TZ_ICT, "pool.ntp.org", "time.google.com", "time.cloudflare.com");

  const uint32_t start = millis();
  struct tm timeinfo;
  while (millis() - start < timeoutMs) {
    if (getLocalTime(&timeinfo, 1000)) {
      return true;
    }
  }
  return false;
}

uint64_t secondsUntilNextTarget() {
  time_t now;
  time(&now);

  struct tm t;
  localtime_r(&now, &t);

  // Build "today at 11:15"
  struct tm target = t;
  target.tm_hour = TARGET_HOUR;
  target.tm_min  = TARGET_MINUTE;
  target.tm_sec  = 0;

  time_t targetEpoch = mktime(&target);

  // If we're already past today's 11:15, schedule for tomorrow.
  if (difftime(targetEpoch, now) <= 0) {
    target.tm_mday += 1; // normalize via mktime
    targetEpoch = mktime(&target);
  }

  double diff = difftime(targetEpoch, now);
  if (diff < 1) diff = 1;

  return (uint64_t)diff;
}

void goToSleepForSeconds(uint64_t seconds) {
  // Turn off LEDs before sleeping
  setAllLeds(false);

  // Timer wakeup
  esp_sleep_enable_timer_wakeup((uint64_t)seconds * 1000000ULL);

  // Optional: reduce power (WiFi already off after disconnect)
  WiFi.mode(WIFI_OFF);
  btStop();

  esp_deep_sleep_start();
}

void blinkRgbThenSleep() {
  const uint32_t start = millis();
  bool on = false;

  while (millis() - start < BLINK_DURATION_MS) {
    on = !on;
    setAllLeds(on);
    delay(BLINK_PERIOD_MS);
  }

  // After blinking, compute next wake time and sleep again
  uint64_t secs = secondsUntilNextTarget();
  goToSleepForSeconds(secs);
}

void setup() {
  Serial.begin(115200);
  delay(200);

  pinMode(RED_LED_PIN, OUTPUT);
  pinMode(GREEN_LED_PIN, OUTPUT);
  pinMode(BLUE_LED_PIN, OUTPUT);
  setAllLeds(false);

  // Connect WiFi to sync time
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);

  Serial.print("Connecting to WiFi");
  uint32_t wifiStart = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - wifiStart < 20000) {
    delay(300);
    Serial.print(".");
  }
  Serial.println();

  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("WiFi failed. Sleeping 10 minutes then retrying.");
    goToSleepForSeconds(10 * 60);
  }

  Serial.println("WiFi connected. Syncing time...");
  if (!syncTimeWithNTP()) {
    Serial.println("NTP sync failed. Sleeping 10 minutes then retrying.");
    goToSleepForSeconds(10 * 60);
  }

  // Print current local time for debugging
  struct tm nowTm;
  if (getLocalTime(&nowTm)) {
    Serial.printf("Local time: %04d-%02d-%02d %02d:%02d:%02d\n",
                  nowTm.tm_year + 1900, nowTm.tm_mon + 1, nowTm.tm_mday,
                  nowTm.tm_hour, nowTm.tm_min, nowTm.tm_sec);
  }

  // If we woke up at/near the target time, blink.
  // Otherwise sleep until next 11:15.
  uint64_t secs = secondsUntilNextTarget();

  // If it's within ~60 seconds of 11:15, do the blink routine now.
  // (This helps if wake happened a bit late/early.)
  if (secs > (24ULL * 3600ULL - 60ULL) || secs < 60ULL) {
    Serial.println("At/near target time. Blinking now.");
    blinkRgbThenSleep();
  } else {
    Serial.printf("Sleeping until next %02d:%02d (in %llu seconds)\n",
                  TARGET_HOUR, TARGET_MINUTE, (unsigned long long)secs);
    goToSleepForSeconds(secs);
  }
}

void loop() {
  // Not used — ESP32 will deep sleep from setup()
}
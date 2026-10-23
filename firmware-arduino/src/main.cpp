#include "Battery.h"
#include "InputGesture.h"
#include "TouchInput.h"
#include "FactoryReset.h"
#include "LEDHandler.h"
#include "OTA.h"
#include "WifiManager.h"
#include <driver/touch_sensor.h>
#include <driver/rtc_io.h>
#include <algorithm>

#ifdef TOUCH_MODE
RTC_DATA_ATTR uint32_t retainedTouchBaseline = 0;
TouchInput touchInput;
uint32_t lastTouchRaw = 0;

void setupTouchInput() {
  // Let the Arduino driver initialize/configure the channel once. Calling
  // touch_pad_init() separately duplicates that driver's initialization.
  touchRead(uint8_t(BUTTON_PIN));
  if (esp_sleep_get_wakeup_cause() != ESP_SLEEP_WAKEUP_TOUCHPAD || !retainedTouchBaseline) {
    uint32_t samples[32];
    size_t count = 0;
    for (int i = 0; i < 32; ++i) {
      uint32_t raw = touchRead(uint8_t(BUTTON_PIN));
      if (raw) samples[count++] = raw;
      delay(10);
    }
    if (count) {
      std::sort(samples, samples + count);
      retainedTouchBaseline = samples[count / 2];
    }
  }
  touchInput.configure(retainedTouchBaseline);
  Serial.printf("[Touch] GPIO%d baseline=%lu press=%lu release=%lu wake_delta=%lu\n",
      int(BUTTON_PIN), (unsigned long)retainedTouchBaseline,
      (unsigned long)touchInput.pressThreshold(),
      (unsigned long)touchInput.releaseThreshold(),
      (unsigned long)touchInput.pressDelta());
}
#endif

AsyncWebServer webServer(80);
WIFIMANAGER WifiManager;
esp_err_t getErr = ESP_OK;

bool inputPressed() {
#ifdef TOUCH_MODE
  lastTouchRaw = touchRead(uint8_t(BUTTON_PIN));
  return touchInput.sample(lastTouchRaw);
#else
  return digitalRead(BUTTON_PIN) == LOW;
#endif
}

// Input task requests shutdown; only the main loop performs it.
void enterSleep() {
  if (shutdownInProgress) return;
  shutdownInProgress = true;
  Serial.println("Going to sleep...");

  // First, change device state to prevent any new data processing
  deviceState = SLEEP;
  scheduleListeningRestart = false;
  digitalWrite(I2S_SD_OUT, LOW); // mute the amplifier
  i2sOutputFlushScheduled = true;
  i2sInputFlushScheduled = true;
  vTaskDelay(10); // let all tasks accept state

  xSemaphoreTake(wsMutex, portMAX_DELAY);

  // Stop audio tasks first
  i2s_stop(I2S_PORT_IN);
  i2s_stop(I2S_PORT_OUT);

  // Properly disconnect WebSocket and wait for it to complete
  if (webSocket.isConnected()) {
    webSocket.disconnect();
    // Give some time for the disconnect to process
  }
  xSemaphoreGive(wsMutex);
  delay(100);

  // Deep sleep resets the drivers. Do not free them here while another task
  // may still be returning from an in-flight I2S read/write.

  // Flush any remaining serial output
  Serial.flush();

#ifdef TOUCH_MODE
  touch_pad_intr_disable(TOUCH_PAD_INTR_MASK_ALL);
#endif
  // The input is also the wake source. A held/bouncing input must not wake
  // us immediately after sleeping. Require 500 ms continuously released.
  Serial.println("Waiting for input release before deep sleep...");
  unsigned long releasedAt = millis();
  while (millis() - releasedAt < 500) {
    if (inputPressed()) releasedAt = millis();
    delay(10);
  }
#ifdef TOUCH_MODE
  // S3 sleep thresholds are a change from the hardware benchmark, not the
  // absolute raw count used by the awake gesture detector.
  touchSleepWakeUpEnable(uint8_t(BUTTON_PIN), touchInput.pressDelta());
#else
  // EXT0 uses the RTC pad; retain a defined HIGH while the button is released.
  rtc_gpio_init(BUTTON_PIN);
  rtc_gpio_set_direction(BUTTON_PIN, RTC_GPIO_MODE_INPUT_ONLY);
  rtc_gpio_pullup_en(BUTTON_PIN);
  rtc_gpio_pulldown_dis(BUTTON_PIN);
#endif

  prepareBatteryForSleep();
  Serial.println("Entering deep sleep; press the input to wake.");
  Serial.flush();
  esp_deep_sleep_start();
  delay(1000);
}

void processSleepRequest() {
  if (sleepRequested) {
    sleepRequested = false;
    enterSleep(); // Just call it directly - no state checking needed
  }
}

void printOutESP32Error(esp_err_t err) {
  switch (err) {
  case ESP_OK:
    Serial.println("ESP_OK no errors");
    break;
  case ESP_ERR_INVALID_ARG:
    Serial.println("ESP_ERR_INVALID_ARG if the selected GPIO is not an RTC "
                   "GPIO, or the mode is invalid");
    break;
  case ESP_ERR_INVALID_STATE:
    Serial.println("ESP_ERR_INVALID_STATE if wakeup triggers conflict or "
                   "wireless not stopped");
    break;
  default:
    Serial.printf("Unknown error code: %d\n", err);
    break;
  }
}

void getAuthTokenFromNVS() {
  preferences.begin("auth", false);
  authTokenGlobal = preferences.getString("auth_token", "");
  preferences.end();
}

void setupWiFi() {
  WifiManager.startBackgroundTask(
      "ELATO-DEVICE"); // Run the background task to take care of our Wifi
  WifiManager.fallbackToSoftAp(
      true); // Run a SoftAP if no known AP can be reached
  WifiManager.attachWebServer(&webServer); // Attach our API to the Webserver
  WifiManager.attachUI();                  // Attach the UI to the Webserver

  // Run the Webserver and add your webpages to it
  webServer.on("/", HTTP_GET, [](AsyncWebServerRequest *request) {
    request->redirect("/wifi");
  });
  webServer.onNotFound([](AsyncWebServerRequest *request) {
    request->send(404, "text/plain", "Not found");
  });
  webServer.begin();
}

void inputTask(void *parameter) {
  InputGesture gesture;
#ifdef TOUCH_MODE
  unsigned long lastTouchLog = 0;
#endif
  while (1) {
    if (shutdownInProgress) {
      vTaskDelete(NULL);
      return;
    }
    switch (gesture.update(inputPressed(), millis())) {
    case InputGesture::Event::ShortPress:
      requestSpeechInterrupt();
      break;
    case InputGesture::Event::DoubleTap:
      Serial.println("Input double tap: sleep requested");
      sleepRequested = true;
      break;
    case InputGesture::Event::LongPress:
      Serial.println("Input held for 1.5 seconds: sleep requested");
      sleepRequested = true;
      break;
    case InputGesture::Event::None:
      break;
    }
#ifdef TOUCH_MODE
    if (millis() - lastTouchLog >= 1000) {
      lastTouchLog = millis();
      Serial.printf("[Touch] raw=%lu\n", (unsigned long)lastTouchRaw);
    }
#endif
    vTaskDelay(pdMS_TO_TICKS(10));
  }
}

void setupDeviceMetadata() {
  // factoryResetDevice();
  // resetAuth();

  deviceState = IDLE;

  getAuthTokenFromNVS();
  getOTAStatusFromNVS();

  if (otaState == OTA_IN_PROGRESS || otaState == OTA_COMPLETE) {
    deviceState = OTA;
  }
  if (factory_reset_status) {
    deviceState = FACTORY_RESET;
  }
}

void setup() {
  Serial.begin(115200);
  delay(500);

  // SETUP
  setupDeviceMetadata();
  wsMutex = xSemaphoreCreateMutex();
  setupBattery();

// INTERRUPT
#ifdef TOUCH_MODE
  setupTouchInput();
#else
  // Release RTC ownership left by EXT0 wake before using the GPIO normally.
  rtc_gpio_deinit(BUTTON_PIN);
  pinMode(BUTTON_PIN, INPUT_PULLUP);
  getErr = esp_sleep_enable_ext0_wakeup(BUTTON_PIN, LOW);
  printOutESP32Error(getErr);
#endif
  Serial.printf("[Input] wake cause: %d; short tap interrupts, double tap/1.5s hold sleeps\n",
                int(esp_sleep_get_wakeup_cause()));
  xTaskCreate(inputTask, "Input Task", 4096, NULL, 4, NULL);

  // Pin audio tasks to Core 1 (application core)
  xTaskCreatePinnedToCore(ledTask,    // Function
                          "LED Task", // Name
                          4096,       // Stack size
                          NULL,       // Parameters
                          5,          // Priority
                          NULL,       // Handle
                          1           // Core 1 (application core)
  );

  xTaskCreatePinnedToCore(audioStreamTask, // Function
                          "Speaker Task",  // Name
                          4096,            // Stack size
                          NULL,            // Parameters
                          3,               // Priority
                          NULL,            // Handle
                          1                // Core 1 (application core)
  );

  xTaskCreatePinnedToCore(micTask,           // Function
                          "Microphone Task", // Name
                          4096,              // Stack size
                          NULL,              // Parameters
                          4,                 // Priority
                          NULL,              // Handle
                          1                  // Core 1 (application core)
  );

  // Pin network task to Core 0 (protocol core)
  xTaskCreatePinnedToCore(networkTask,              // Function
                          "Websocket Task",         // Name
                          8192,                     // Stack size
                          NULL,                     // Parameters
                          configMAX_PRIORITIES - 1, // Highest priority
                          &networkTaskHandle,       // Handle
                          0                         // Core 0 (protocol core)
  );

  // WIFI
  setupWiFi();
}

void loop() {
  processSleepRequest();
  if (otaState == OTA_IN_PROGRESS) {
    loopOTA();
  }
}

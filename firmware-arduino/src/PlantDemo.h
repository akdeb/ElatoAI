#pragma once
// "The plant talks back" demo (build env `plant-demo`, defines PLANT_DEMO).
//
//  - Soil moisture module: A0 -> GPIO4 (analog), D0 -> GPIO3 (digital threshold).
//    Readings stream to the voice server as {"type":"sensor",...} text frames.
//  - 128x64 I2C OLED (SSD1306 by default, -D PLANT_OLED_SH1106 for the 1.3" SH1106)
//    on the board's I2C bus. Left: animated plant face. Right: live captions.
//
// Server messages handled (type "server"): TRANSCRIPT.USER, TRANSCRIPT.AGENT, FACE.
#ifdef PLANT_DEMO
#include <Arduino.h>
#include <ArduinoJson.h>

void plantSetup();                        // call once from setup()
void plantDisplayTask(void *parameter);   // FreeRTOS task: draws the OLED
// networkTask, with wsMutex held: samples the sensor and sends it when due.
void plantSensorTick();
// enterSleep: blanks and powers down the OLED (it is on 3V3 and would keep its last frame).
void plantDisplayOff();
// webSocketEvent: returns true if the message was a plant message.
bool plantHandleServerMessage(const String &msg, JsonDocument &doc);
#endif

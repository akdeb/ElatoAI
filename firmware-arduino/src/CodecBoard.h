#pragma once
#include <Arduino.h>

// Speaker amplifier enable. Safe to call from any task.
//   Default board (MAX98357A): drives I2S_SD_OUT.
//   ELATO_BOARD_VOICE_V1 (NS4150B): TCA9555 P10 over I2C.
void audioBoardSetAmp(bool on);

#ifdef ELATO_BOARD_VOICE_V1
// elato-voice-cam v1: ES8311 DAC (0x18) + ES7210 ADC (0x40) + TCA9555 (0x20)
// on I2C SDA 11 / SCL 10, sharing one I2S bus (MCLK 12, BCLK 13, LRCK 14,
// ADC data -> GPIO15, DAC data <- GPIO16). Both codecs are I2S slaves and
// follow whatever rate the ESP32 clocks, so half-duplex rate switching
// (16 kHz listen / 48 kHz speak) needs no codec reconfiguration.

// Configures both codecs and the expander. Call after the I2S port is
// running (the codecs need MCLK). Leaves the amp off.
bool audioBoardBeginCodecs();

// Mutes and powers the codecs down before deep sleep.
void audioBoardSleep();
#endif

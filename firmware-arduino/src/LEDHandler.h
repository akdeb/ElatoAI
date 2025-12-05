#ifndef LEDHANDLER_H
#define LEDHANDLER_H

#include "Config.h"
#include <stdint.h>

// Grundfarben per Name
void setLEDColor(uint8_t r, uint8_t g, uint8_t b);
void turnOffLED();
void turnOnLED();
void setupRGBLED();
void ledTask(void *parameter);

// (optional) Status-Farben bequem setzen
enum class StaticColor : uint8_t {
  RED, GREEN, BLUE, YELLOW, MAGENTA, CYAN, WHITE, OFF
};
void setStaticColor(StaticColor color);

#endif

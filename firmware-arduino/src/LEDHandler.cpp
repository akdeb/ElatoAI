#include "LEDHandler.h"
#include "Config.h"            // für deviceState & State-Enums
#include <Adafruit_NeoPixel.h>
#include <Arduino.h>

// ================== Board-spezifisch ==================
#define LED_PIN    48    // Freenove: WS2812 an GPIO 48
#define LED_COUNT  1

static Adafruit_NeoPixel strip(LED_COUNT, LED_PIN, NEO_GRB + NEO_KHZ800);

// ================== LED-Interna ==================
static uint8_t  g_brightness = 20;   // 0..255 (NeoPixel Brightness)
static uint32_t lastToggle   = 0;
static bool     ledState     = false;

// kleiner Helfer (sicher auf 0..255 begrenzen)
static inline uint8_t clamp8(int v) { return (v < 0) ? 0 : (v > 255) ? 255 : (uint8_t)v; }

// zentral setzen & anzeigen
static inline void ws_show_rgb(uint8_t r, uint8_t g, uint8_t b) {
  strip.setPixelColor(0, strip.Color(r, g, b));
  strip.show();
}

// ================== öffentliche API ==================
void setupRGBLED() {
  strip.begin();
  strip.setBrightness(g_brightness);
  strip.show(); // aus
}

void setLEDColor(uint8_t r, uint8_t g, uint8_t b) {
  ws_show_rgb(r, g, b);
}

void turnOffLED() { ws_show_rgb(0, 0, 0); }
void turnOnLED()  { ws_show_rgb(255, 255, 255); }

void setStaticColor(StaticColor color) {
  switch (color) {
    case StaticColor::RED:     ws_show_rgb(255,   0,   0); break;
    case StaticColor::GREEN:   ws_show_rgb(  0, 255,   0); break;
    case StaticColor::BLUE:    ws_show_rgb(  0,   0, 255); break;
    case StaticColor::YELLOW:  ws_show_rgb(255, 255,   0); break;
    case StaticColor::MAGENTA: ws_show_rgb(255,   0, 255); break;
    case StaticColor::CYAN:    ws_show_rgb(  0, 255, 255); break;
    case StaticColor::WHITE:   ws_show_rgb(255, 255, 255); break;
    case StaticColor::OFF:     ws_show_rgb(  0,   0,   0); break;
    default:                   ws_show_rgb(  0,   0,   0); break;
  }
}

// sanftes Atmen (nicht blockierend)
static void breatheColor(uint8_t r, uint8_t g, uint8_t b) {
  static uint16_t t = 0;           // 0..149
  t = (t + 1) % 150;               // ~3 Hz / 20 ms Schritte
  float phase = (t < 75) ? (t / 75.0f) : (2.0f - t / 75.0f); // 0..1..0
  float g1 = phase * phase;        // leichte Gamma
  uint8_t rr = clamp8((int)(r * g1));
  uint8_t gg = clamp8((int)(g * g1));
  uint8_t bb = clamp8((int)(b * g1));
  ws_show_rgb(rr, gg, bb);
}

void ledTask(void *parameter) {
  setupRGBLED();
  const TickType_t tick = 20 / portTICK_PERIOD_MS;   // 20 ms Tick

  for (;;) {
    uint32_t now = millis();
    if (now - lastToggle >= 200) {       // optionaler 5 Hz Toggler (falls gebraucht)
      ledState  = !ledState;
      lastToggle = now;
    }

    // deviceState stammt aus deiner State-Machine (Config.h)
    switch (deviceState) {
      case IDLE:        setStaticColor(StaticColor::GREEN);   break;
      case SOFT_AP:     breatheColor(255, 0, 255);            break; // Magenta
      case PROCESSING:  breatheColor(255, 64, 0);             break; // Amber
      case SPEAKING:    setStaticColor(StaticColor::BLUE);    break;
      case LISTENING:   setStaticColor(StaticColor::YELLOW);  break;
      case OTA:         setStaticColor(StaticColor::CYAN);    break;
      default:          setStaticColor(StaticColor::WHITE);   break;
    }

    vTaskDelay(tick);
  }
}

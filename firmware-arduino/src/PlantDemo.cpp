#ifdef PLANT_DEMO
#include "PlantDemo.h"
#include "Audio.h"
#include "Config.h"
#include <U8g2lib.h>
#include <Wire.h>

// CodecBoard's lock for the shared I2C bus (codecs + TCA9555 amp switch).
extern SemaphoreHandle_t i2cMutex;
// The OLED does NOT take i2cMutex: Wire already makes each transaction atomic, and a
// stuck OLED write must never keep the amp switch (TCA9555) or shutdown waiting.
// Only the one-time setup (scan + begin) and the bus recovery take the codec lock.
static bool busHeld = false;
static void busLock() { busHeld = i2cMutex && xSemaphoreTake(i2cMutex, pdMS_TO_TICKS(200)) == pdTRUE; }
static void busUnlock() { if (busHeld) { busHeld = false; xSemaphoreGive(i2cMutex); } }

// ---------------- pins & calibration (override with -D) ----------------
#ifndef PLANT_SOIL_A0_PIN
#define PLANT_SOIL_A0_PIN 4
#endif
#ifndef PLANT_SOIL_D0_PIN
#define PLANT_SOIL_D0_PIN 3
#endif
// Raw 12-bit ADC readings at the two ends; either direction works (the mapping is linear).
// Resistive modules usually read high when dry, but the demo probe jumps UP when water is poured.
// Calibrate from the "[Plant] soil raw=" serial log: probe in air, then in a cup of water.
#ifndef PLANT_SOIL_DRY_RAW
#define PLANT_SOIL_DRY_RAW 1000  // this probe in this soil reads ~1050-1080 before watering
#endif
#ifndef PLANT_SOIL_WET_RAW
#define PLANT_SOIL_WET_RAW 1600  // a pour pushed it to ~1430: this probe reads HIGHER when watered
#endif
#ifndef PLANT_OLED_SDA
#ifdef ELATO_BOARD_VOICE_V1
#define PLANT_OLED_SDA I2C_SDA_PIN   // shares the codec bus (0x18/0x20/0x40); OLED is 0x3C
#define PLANT_OLED_SCL I2C_SCL_PIN
#else
#error "Set PLANT_OLED_SDA / PLANT_OLED_SCL for this board"
#endif
#endif

// U8g2 only draws (fonts, ellipses) into its 1 KB buffer; it never touches the bus.
// Its full-buffer layout (8 pages x 128 column bytes) is the SSD1306's own, so frames
// are copied into the Adafruit driver, which does the I2C the same way gta-aquaworld's
// npc_voice does on this board: begin() after the codecs, reusing their Wire.
#include <Adafruit_SSD1306.h>
static U8G2_SSD1306_128X64_NONAME_F_HW_I2C oled(U8G2_R0, U8X8_PIN_NONE, PLANT_OLED_SCL, PLANT_OLED_SDA);
static Adafruit_SSD1306 panel(128, 64, &Wire, -1);
static bool panelOk = false;

// ---------------- shared state (networkTask writes, display task reads) ----------------
enum Face : uint8_t { FACE_HAPPY, FACE_THIRSTY, FACE_SHOCKED, FACE_LOVE, FACE_SLEEPY, FACE_ANNOYED };

static SemaphoreHandle_t stateMutex;
static constexpr size_t CAPTION_MAX = 480;
static char caption[CAPTION_MAX + 1] = "";
static bool captionIsUser = false;
static Face baseFace = FACE_HAPPY;
static Face holdFace = FACE_HAPPY;
static unsigned long holdUntil = 0;
static volatile int moisturePct = -1;

static Face parseFace(const char *s) {
  if (!s) return FACE_HAPPY;
  if (!strcmp(s, "thirsty")) return FACE_THIRSTY;
  if (!strcmp(s, "shocked")) return FACE_SHOCKED;
  if (!strcmp(s, "love")) return FACE_LOVE;
  if (!strcmp(s, "sleepy")) return FACE_SLEEPY;
  if (!strcmp(s, "annoyed")) return FACE_ANNOYED;
  return FACE_HAPPY;
}

// Keeps the tail when the caption overflows.
static void appendCaption(const char *text) {
  size_t cur = strlen(caption), add = strlen(text);
  size_t need = cur + (cur ? 1 : 0) + add;
  if (need > CAPTION_MAX) {
    size_t drop = need - CAPTION_MAX;
    if (drop >= cur) { cur = 0; caption[0] = 0; }
    else { memmove(caption, caption + drop, cur - drop + 1); cur -= drop; }
  }
  if (cur) strncat(caption, " ", CAPTION_MAX - strlen(caption));
  strncat(caption, text, CAPTION_MAX - strlen(caption));
}

bool plantHandleServerMessage(const String &msg, JsonDocument &doc) {
  bool user = msg == "TRANSCRIPT.USER";
  if (user || msg == "TRANSCRIPT.AGENT") {
    const char *text = doc["text"] | "";
    xSemaphoreTake(stateMutex, portMAX_DELAY);
    if (user) {
      // STT partials are cumulative within a turn: replace, don't append.
      strncpy(caption, text, CAPTION_MAX);
      caption[CAPTION_MAX] = 0;
    } else {
      if (captionIsUser) caption[0] = 0;
      appendCaption(text);
    }
    captionIsUser = user;
    xSemaphoreGive(stateMutex);
    return true;
  }
  if (msg == "FACE") {
    Face f = parseFace(doc["face"] | "happy");
    uint32_t hold = doc["hold_ms"] | 0;
    xSemaphoreTake(stateMutex, portMAX_DELAY);
    if (hold) { holdFace = f; holdUntil = millis() + hold; }
    else baseFace = f;
    xSemaphoreGive(stateMutex);
    return true;
  }
  return false;
}

// ---------------- sensor ----------------
void plantSetup() {
  stateMutex = xSemaphoreCreateMutex();
  pinMode(PLANT_SOIL_D0_PIN, INPUT);
  analogReadResolution(12);
  analogSetPinAttenuation(PLANT_SOIL_A0_PIN, ADC_11db);
}

void plantSensorTick() {
  static float ema = -1;
  static unsigned long lastSample = 0, lastSend = 0, lastLog = 0;
  unsigned long now = millis();
  if (now - lastSample < 100) return;
  lastSample = now;

  int raw = analogRead(PLANT_SOIL_A0_PIN);
  ema = ema < 0 ? raw : ema * 0.7f + raw * 0.3f;
  float pct = (PLANT_SOIL_DRY_RAW - ema) * 100.0f / float(PLANT_SOIL_DRY_RAW - PLANT_SOIL_WET_RAW);
  pct = constrain(pct, 0.0f, 100.0f);
  moisturePct = int(pct + 0.5f);
  bool wet = digitalRead(PLANT_SOIL_D0_PIN) == LOW; // module pulls D0 low above its pot threshold

  if (now - lastLog >= 2000) {
    lastLog = now;
    Serial.printf("[Plant] soil raw=%d ema=%.0f moisture=%d%% d0_wet=%d\n", raw, ema, moisturePct, wet);
  }
  if (now - lastSend >= 500 && webSocket.isConnected()) {
    lastSend = now;
    char buf[96];
    snprintf(buf, sizeof(buf), "{\"type\":\"sensor\",\"moisture\":%.1f,\"raw\":%d,\"wet\":%s}",
             pct, int(ema), wet ? "true" : "false");
    webSocket.sendTXT(buf);
  }
}

// ---------------- drawing ----------------
// Face area: x 0..49. Caption area: x 52..127.
static constexpr int CX = 24;

static void drawLeaves(Face f, float t) {
  int sway = int(sinf(t * 2.2f) * 1.5f);
  if (f == FACE_THIRSTY || f == FACE_SLEEPY) {
    // Wilted: stem bends over, leaves hang down.
    oled.drawLine(CX, 35, CX + 1, 24);
    oled.drawLine(CX + 1, 24, CX + 7, 18);
    oled.drawFilledEllipse(CX - 6 + sway, 28, 3, 7);
    oled.drawFilledEllipse(CX + 10, 25 + sway, 3, 7);
    return;
  }
  if (f == FACE_SHOCKED) {
    // Leaves straight up, plus flying water drops.
    int jit = (int(t * 20) & 1) ? 1 : -1;
    oled.drawLine(CX, 35, CX, 16);
    oled.drawFilledEllipse(CX - 7 + jit, 14, 3, 9);
    oled.drawFilledEllipse(CX + 7 - jit, 14, 3, 9);
    int d = int(t * 30) % 12;
    oled.drawDisc(4, 12 + d, 1);
    oled.drawDisc(44, 22 + d / 2, 1);
    oled.drawDisc(40, 4 + d, 1);
    return;
  }
  oled.drawLine(CX, 35, CX, 14);
  oled.drawFilledEllipse(CX - 9, 18 + sway, 9, 4);
  oled.drawFilledEllipse(CX + 9, 13 - sway, 9, 4);
  oled.drawFilledEllipse(CX, 9, 3, 5);
}

static void drawHeart(int x, int y) {
  oled.drawDisc(x - 2, y, 2);
  oled.drawDisc(x + 2, y, 2);
  oled.drawTriangle(x - 4, y + 1, x + 4, y + 1, x, y + 5);
}

static void drawPotFace(Face f, float t, bool talking, bool listening, unsigned long now) {
  // Pot (white), face drawn in black on it.
  oled.drawBox(3, 36, 43, 6);
  oled.drawTriangle(6, 42, 42, 42, 11, 63);
  oled.drawTriangle(42, 42, 11, 63, 37, 63);
  oled.drawBox(11, 42, 27, 22);
  oled.setDrawColor(0);

  int look = listening ? 2 : 0;
  int ex1 = CX - 7 + look, ex2 = CX + 7 + look, ey = 48;
  bool blink = (now % 3800) < 140;

  switch (f) {
  case FACE_SHOCKED:
    oled.drawDisc(ex1, ey, 3); oled.drawDisc(ex2, ey, 3);
    oled.setDrawColor(1); oled.drawPixel(ex1, ey); oled.drawPixel(ex2, ey); oled.setDrawColor(0);
    break;
  case FACE_LOVE:
    drawHeart(ex1, ey - 2); drawHeart(ex2, ey - 2);
    break;
  case FACE_SLEEPY:
  case FACE_THIRSTY:
    oled.drawHLine(ex1 - 2, ey + 1, 5); oled.drawHLine(ex2 - 2, ey + 1, 5);
    oled.drawPixel(ex1, ey + 2); oled.drawPixel(ex2, ey + 2);
    break;
  case FACE_ANNOYED:
    oled.drawLine(ex1 - 3, ey - 3, ex1 + 2, ey - 1); oled.drawLine(ex2 + 3, ey - 3, ex2 - 2, ey - 1);
    oled.drawBox(ex1 - 1, ey, 3, 2); oled.drawBox(ex2 - 1, ey, 3, 2);
    break;
  default:
    if (blink) { oled.drawHLine(ex1 - 2, ey, 5); oled.drawHLine(ex2 - 2, ey, 5); }
    else { oled.drawDisc(ex1, ey, 2); oled.drawDisc(ex2, ey, 2); }
  }

  int mx = CX + look, my = 57;
  if (talking) {
    // Mouth flaps at a speech-ish rate.
    static const uint8_t open[] = {1, 3, 2, 4, 1, 3, 4, 2};
    int h = open[(now / 90) % 8];
    if (f == FACE_SHOCKED) h += 1;
    oled.drawFilledEllipse(mx, my, 4, h);
  } else if (f == FACE_SHOCKED) {
    oled.drawEllipse(mx, my, 3, 4);
  } else if (f == FACE_THIRSTY || f == FACE_ANNOYED) {
    oled.drawCircle(mx, my + 4, 4, U8G2_DRAW_UPPER_LEFT | U8G2_DRAW_UPPER_RIGHT);
  } else if (f == FACE_SLEEPY) {
    oled.drawHLine(mx - 2, my, 5);
  } else {
    oled.drawCircle(mx, my - 2, 5, U8G2_DRAW_LOWER_LEFT | U8G2_DRAW_LOWER_RIGHT);
  }
  oled.setDrawColor(1);

  if (f == FACE_SLEEPY) {
    oled.setFont(u8g2_font_5x8_tr);
    int z = int(t * 2) % 3;
    oled.drawStr(36 + z, 10 - z * 2, "z");
  }
  if (f == FACE_THIRSTY) {
    // Sweat drop
    int d = int(t * 8) % 6;
    oled.drawDisc(41, 46 + d, 1);
  }
}

// Word-wraps `text` into lines of at most `cols` chars; returns the line count.
static int wrapText(const char *text, int cols, char lines[][17], int maxLines) {
  int n = 0, len = 0;
  char word[48];
  const char *p = text;
  char cur[17] = "";
  // Ring of the last maxLines lines, so long captions show their tail.
  while (*p) {
    while (*p == ' ') p++;
    if (!*p) break;
    int w = 0;
    while (*p && *p != ' ' && w < (int)sizeof(word) - 1) word[w++] = *p++;
    word[w] = 0;
    // Words longer than a line get hard-split.
    int off = 0;
    while (off < w) {
      int chunk = min(w - off, cols);
      int extra = len ? 1 : 0;
      if (len + extra + chunk > cols) {
        strcpy(lines[n % maxLines], cur); n++;
        cur[0] = 0; len = 0; extra = 0;
      }
      if (extra) { cur[len++] = ' '; cur[len] = 0; }
      memcpy(cur + len, word + off, chunk); len += chunk; cur[len] = 0;
      off += chunk;
    }
  }
  if (len) { strcpy(lines[n % maxLines], cur); n++; }
  return n;
}

static void drawCaption(const char *text, bool isUser) {
  constexpr int X = 52, COLS = 15, ROWS = 6, LH = 9;
  oled.setFont(u8g2_font_5x8_tr);
  // Header: who is talking.
  oled.drawBox(X, 0, 76, 9);
  oled.setDrawColor(0);
  oled.drawStr(X + 2, 7, isUser ? "YOU" : "PLANT");
  oled.setDrawColor(1);

  static char lines[ROWS][17];
  int n = wrapText(text, COLS, lines, ROWS);
  int first = n > ROWS ? n - ROWS : 0;
  for (int i = first, row = 0; i < n; i++, row++) {
    oled.drawStr(X, 9 + LH * (row + 1) - 1, lines[i % ROWS]);
  }
}

// Unjams the shared bus: a slave left holding SDA low after an aborted transfer is
// clocked out with 9 SCL pulses and a STOP, then Wire is restarted. Caller holds busLock.
static void busRecover() {
  Serial.println("[Plant] I2C bus stuck, recovering");
  Wire.end();
  pinMode(PLANT_OLED_SDA, INPUT_PULLUP);
  pinMode(PLANT_OLED_SCL, OUTPUT_OPEN_DRAIN);
  for (int i = 0; i < 9 && digitalRead(PLANT_OLED_SDA) == LOW; i++) {
    digitalWrite(PLANT_OLED_SCL, LOW); delayMicroseconds(10);
    digitalWrite(PLANT_OLED_SCL, HIGH); delayMicroseconds(10);
  }
  pinMode(PLANT_OLED_SDA, OUTPUT_OPEN_DRAIN);              // STOP: SDA low -> high while SCL high
  digitalWrite(PLANT_OLED_SDA, LOW); delayMicroseconds(10);
  digitalWrite(PLANT_OLED_SCL, HIGH); delayMicroseconds(10);
  digitalWrite(PLANT_OLED_SDA, HIGH); delayMicroseconds(10);
  Wire.begin(PLANT_OLED_SDA, PLANT_OLED_SCL, 100000);
  Wire.setTimeOut(50);
}

static bool busHealthy() {
  Wire.beginTransmission(0x20); // TCA9555: the amp switch must always answer
  return Wire.endTransmission() == 0;
}

// Pushes the drawn frame to the panel, only when it changed.
static void pushChanges() {
  static uint8_t prev[1024];
  static bool primed = false;
  if (!panelOk) return;
  uint8_t *buf = oled.getBufferPtr();
  if (primed && !memcmp(buf, prev, sizeof(prev))) return;
  memcpy(prev, buf, sizeof(prev));
  primed = true;
  memcpy(panel.getBuffer(), buf, sizeof(prev));
  panel.display();
}

void plantDisplayOff() {
  if (!panelOk) return;
  panel.clearDisplay();
  panel.display();
  panel.ssd1306_command(SSD1306_DISPLAYOFF);
}

void plantDisplayTask(void *parameter) {
  // Let the codec init on the shared bus finish first.
  vTaskDelay(pdMS_TO_TICKS(1500));
  for (int pass = 0; pass < 3; pass++) {   // repeat: USB serial may not be attached yet
    vTaskDelay(pdMS_TO_TICKS(2000));
    String found;
    busLock();
    for (uint8_t addr = 1; addr < 127; addr++) {
      Wire.beginTransmission(addr);
      if (Wire.endTransmission() == 0) found += String(" 0x") + String(addr, HEX);
    }
    busUnlock();
    Serial.printf("[Plant] I2C on SDA%d/SCL%d:%s (OLED should be 0x3c)\n",
                  PLANT_OLED_SDA, PLANT_OLED_SCL, found.c_str());
  }
  busLock();
  // (vcc, addr, reset, periphBegin=false): Wire was already started by the codecs.
  panelOk = panel.begin(SSD1306_SWITCHCAPVCC, 0x3C, true, false);
  if (panelOk) { panel.clearDisplay(); panel.display(); }
  Wire.setTimeOut(50);  // a hiccup must not stall the audio path or shutdown for seconds
  busUnlock();
  Serial.printf("[Plant] OLED %s\n", panelOk ? "ready" : "not found");
  oled.setFontMode(1);

  static char text[CAPTION_MAX + 1];
  while (1) {
    if (shutdownInProgress) {
      vTaskDelete(NULL);  // enterSleep blanks the screen via plantDisplayOff()
      return;
    }
    unsigned long now = millis();
    float t = now / 1000.0f;

    xSemaphoreTake(stateMutex, portMAX_DELAY);
    memcpy(text, caption, sizeof(text));
    bool isUser = captionIsUser;
    Face f = now < holdUntil ? holdFace : baseFace;
    xSemaphoreGive(stateMutex);

    DeviceState st = deviceState;
    bool connected = webSocket.isConnected();
    if (!connected) f = FACE_SLEEPY;

    oled.clearBuffer();
    drawLeaves(f, t);
    drawPotFace(f, t, st == SPEAKING, st == LISTENING && isUser, now);
    int m = moisturePct;
    if (m >= 0) {
      char buf[8];
      snprintf(buf, sizeof(buf), "%d%%", m);
      oled.setFont(u8g2_font_4x6_tr);
      oled.drawStr(0, 6, buf);
    }
    if (!connected) drawCaption(st == SOFT_AP ? "Connect to ELATO-DEVICE wifi" : "zzz... connecting", false);
    else if (text[0]) drawCaption(text, isUser);
    else drawCaption(st == LISTENING ? "listening..." : "", false);
    unsigned long t0 = millis();
    pushChanges();
    unsigned long took = millis() - t0;
    static unsigned long frames = 0, lastBeat = 0, worst = 0;
    frames++;
    if (took > worst) worst = took;
    if (now - lastBeat >= 5000) {
      lastBeat = now;
      Serial.printf("[Plant] display alive: %lu frames, slowest push %lu ms\n", frames, worst);
      worst = 0;
    }
    static unsigned long lastCheck = 0;
    if (now - lastCheck >= 2000) {
      lastCheck = now;
      busLock();
      if (!busHealthy() && !busHealthy()) busRecover();
      busUnlock();
    }

    vTaskDelay(pdMS_TO_TICKS(80));
  }
}
#endif

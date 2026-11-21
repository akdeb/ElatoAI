#include "CodecBoard.h"
#include "Config.h"

#ifndef ELATO_BOARD_VOICE_V1

void audioBoardSetAmp(bool on) {
  static bool configured = false;
  if (!configured) {
    pinMode(I2S_SD_OUT, OUTPUT);
    configured = true;
  }
  digitalWrite(I2S_SD_OUT, on ? HIGH : LOW);
}

#else

// Keep audio-driver out of every file that includes AudioTools.h; both
// libraries define similarly named types.
// Only the driver classes: AudioBoard.h would also construct ~14 unused board
// presets (heap-allocated pin lists) at startup, RAM we can't spare without PSRAM.
#include "AudioDriver.h"  // pschatzmann/arduino-audio-driver
#include <Wire.h>

namespace {

// TCA9555 pins are addressed as 1000 + bit (P00 = 1000 ... P10 = 1008).
constexpr int EXPANDER_OFFSET = 1000;
constexpr int EXPANDER_PA_EN = EXPANDER_OFFSET + 8;  // P10 -> NS4150B CTRL

// ES8311 output level. Server volume is still applied in software
// (VolumeStream), as on the MAX98357A board. The library's curve is
// logarithmic: 51 -> reg 0x32 = 0xBF = 0 dB (80 was 0xE9, about +21 dB, clipping).
constexpr int CODEC_DAC_VOLUME = 51;   // 0-100
constexpr int CODEC_MIC_VOLUME = 80;   // 0-100 -> ES7210 PGA gain

class PinsElatoVoiceV1 : public DriverDeviceInfo {
public:
  PinsElatoVoiceV1() {
    gpio.setAltGPIO(tca9555, EXPANDER_OFFSET);
    // scl, sda, port, frequency, wire. Only the expander gets an I2C entry
    // (as in the library's ES8311+ES7210 preset): a CODEC entry would be one
    // shared address slot for both codecs. Without it each codec uses its own
    // default address (ES8311 0x18, ES7210 0x40) on Wire, which this starts.
    addI2C(PinFunction::EXPANDER, I2C_SCL_PIN, I2C_SDA_PIN, 0, 100000, Wire);
    // mclk, bck, ws, data_out, data_in
    addI2S(PinFunction::CODEC, I2S_MCLK_PIN, I2S_BCLK_PIN, I2S_LRCK_PIN,
           I2S_DOUT_PIN, I2S_DIN_PIN);
    addPin(PinFunction::PA, EXPANDER_PA_EN, PinLogic::Output);
  }

protected:
  TCA9555 tca9555;
};

PinsElatoVoiceV1 boardPins;
AudioDriver &board = AudioDriverES8311_ES7210;
SemaphoreHandle_t i2cMutex = nullptr;
bool codecsReady = false;

}  // namespace

// Bring-up aid: expect 0x18 (ES8311), 0x20 (TCA9555), 0x40 (ES7210).
void scanI2C() {
  pinMode(I2C_SDA_PIN, INPUT);
  pinMode(I2C_SCL_PIN, INPUT);
  delay(2);
  Serial.printf("[I2C] idle levels SDA(GPIO%d)=%d SCL(GPIO%d)=%d (both should be 1)\n",
                I2C_SDA_PIN, digitalRead(I2C_SDA_PIN), I2C_SCL_PIN, digitalRead(I2C_SCL_PIN));
  Wire.begin(I2C_SDA_PIN, I2C_SCL_PIN, 100000);
  int found = 0;
  for (uint8_t addr = 1; addr < 127; ++addr) {
    Wire.beginTransmission(addr);
    if (Wire.endTransmission() == 0) {
      Serial.printf("[I2C] found device at 0x%02X\n", addr);
      ++found;
    }
  }
  Serial.printf("[I2C] scan done, %d device(s)\n", found);
}

bool audioBoardBeginCodecs() {
  if (!i2cMutex) i2cMutex = xSemaphoreCreateMutex();
  xSemaphoreTake(i2cMutex, portMAX_DELAY);
  scanI2C();

  CodecConfig cfg;                    // defaults: 16-bit, I2S, codecs = slave
  cfg.input_device = ADC_INPUT_ALL;   // ES7210 MIC1 + MIC2
  cfg.output_device = DAC_OUTPUT_ALL;
  cfg.i2s.rate = RATE_48K;            // MCLK = 256 * fs at any rate
  cfg.i2s.channels = CHANNELS2;       // MIC1 left, MIC2 right (no TDM)
  cfg.sd_active = false;
  cfg.sdmmc_active = false;
  codecsReady = board.begin(cfg, boardPins);
  if (codecsReady) {
    board.setVolume(CODEC_DAC_VOLUME);
    board.setInputVolume(CODEC_MIC_VOLUME);
    // The driver leaves the ES8311 DAC muted (reg 0x31 = 0x60); unmute it.
    board.setMute(false);
  }
  board.setPAPower(false);  // begin() turns the amp on; start muted
  xSemaphoreGive(i2cMutex);

  Serial.printf("[Codec] ES8311 + ES7210 init %s\n", codecsReady ? "OK" : "FAILED");
  // Bring-up: ES8311 register dump (0x00-0x45).
  xSemaphoreTake(i2cMutex, portMAX_DELAY);
  Serial.print("[ES8311]");
  for (uint8_t r = 0; r <= 0x45; ++r) {
    Wire.beginTransmission(0x18); Wire.write(r);
    int v = -1;
    if (Wire.endTransmission(false) == 0 && Wire.requestFrom((uint8_t)0x18, (uint8_t)1) == 1) v = Wire.read();
    if (r % 16 == 0) Serial.printf("\n  %02X:", r);
    Serial.printf(" %02X", v & 0xFF);
  }
  Serial.println();
  xSemaphoreGive(i2cMutex);
  return codecsReady;
}

// Reads a TCA9555 register (0x03 = output port 1, 0x07 = config port 1).
static int readExpander(uint8_t reg) {
  Wire.beginTransmission(0x20);
  Wire.write(reg);
  if (Wire.endTransmission(false) != 0) return -1;
  if (Wire.requestFrom((uint8_t)0x20, (uint8_t)1) != 1) return -1;
  return Wire.read();
}

void audioBoardSetAmp(bool on) {
  if (!i2cMutex || !codecsReady) return;
  xSemaphoreTake(i2cMutex, portMAX_DELAY);
  board.setPAPower(on);
  int out1 = readExpander(0x03), cfg1 = readExpander(0x07);
  xSemaphoreGive(i2cMutex);
  // P10 is bit 0: expect out=1 and cfg=0 (output) when the amp is on.
  Serial.printf("[Amp] %s: TCA9555 out1=0x%02X cfg1=0x%02X (P10 out=%d, is_output=%d)\n",
                on ? "ON" : "OFF", out1 & 0xFF, cfg1 & 0xFF, out1 & 1, !(cfg1 & 1));
}

void audioBoardSleep() {
  if (!i2cMutex || !codecsReady) return;
  xSemaphoreTake(i2cMutex, portMAX_DELAY);
  board.setPAPower(false);
  board.setMute(true);
  AudioDriverES8311.driver().ctrlStateActive(CODEC_MODE_DECODE, false);
  AudioDriverES7210.driver().ctrlStateActive(CODEC_MODE_ENCODE, false);
  codecsReady = false;
  xSemaphoreGive(i2cMutex);
}

#endif

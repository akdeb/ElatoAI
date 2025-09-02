#ifndef PITCHSHIFT_H
#define PITCHSHIFT_H

#include "AudioTools.h"

//pitch shift effect with interpolaion fixed to 1.5 frequency factor, fixed delay, int16_t, 1 channel
class PitchShiftFixedOutput : public AudioOutput {
public:
  explicit PitchShiftFixedOutput(Print &out) { p_out = &out; }

  PitchShiftInfo defaultConfig() {
    PitchShiftInfo result;
    result.bits_per_sample = sizeof(int16_t) * 8;
    return result;
  }

  bool begin(const PitchShiftInfo& info);

  size_t write(const uint8_t *data, size_t len) override {
    size_t result = 0;
    int16_t *p_in = (int16_t *)data;
    int sample_count = len / sizeof(int16_t);

    for (int j = 0; j < sample_count; j += 1) {
      int16_t value = p_in[j];

      int16_t out_value = pitchShift(value);
      result += p_out->write((uint8_t *)&out_value, sizeof(int16_t));
    }
    return result;
  }

private:
  Print *p_out = nullptr;

  int16_t pitchShift(int16_t value) const;
  uint32_t pitchMul;
  unsigned long secondaryOffset;
};

#endif

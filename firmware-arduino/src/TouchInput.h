#pragma once
#include <stdint.h>

// ESP32-S3 raw touch counts increase on contact. Separate press/release
// thresholds keep small changes around the boundary from chattering.
class TouchInput {
public:
  void configure(uint32_t baseline) { base = baseline; down = false; }
  uint32_t pressDelta() const { return base / 3 > 1000 ? base / 3 : 1000; }
  uint32_t pressThreshold() const { return base + pressDelta(); }
  uint32_t releaseThreshold() const { return base + pressDelta() / 2; }
  bool sample(uint32_t raw) {
    if (!base || !raw) return down;
    down = raw > (down ? releaseThreshold() : pressThreshold());
    return down;
  }
private:
  uint32_t base = 0;
  bool down = false;
};

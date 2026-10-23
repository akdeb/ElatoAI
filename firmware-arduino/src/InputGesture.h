#pragma once
#include <stdint.h>

// Shared by touch and the active-low GPIO button. No gesture is emitted for
// the press that wakes the ESP32: release it first to arm normal input.
class InputGesture {
public:
  enum class Event { None, ShortPress, DoubleTap, LongPress };
  static constexpr uint32_t DEBOUNCE_MS = 30;
  static constexpr uint32_t LONG_PRESS_MS = 1500;
  static constexpr uint32_t DOUBLE_TAP_MS = 350;

  Event update(bool pressed, uint32_t now) {
    if (pressed != rawPressed) {
      rawPressed = pressed;
      rawChangedAt = now;
    }
    if (!armed) {
      if (!pressed && uint32_t(now - rawChangedAt) >= DEBOUNCE_MS) armed = true;
      return Event::None;
    }
    if (pressed != stablePressed && uint32_t(now - rawChangedAt) >= DEBOUNCE_MS) {
      stablePressed = pressed;
      if (pressed) {
        pressedAt = now;
        longSent = false;
      } else if (!longSent) {
        if (haveTap && uint32_t(now - lastTapAt) <= DOUBLE_TAP_MS) {
          haveTap = false;
          return Event::DoubleTap;
        }
        haveTap = true;
        lastTapAt = now;
        return Event::ShortPress;
      }
    }
    if (stablePressed && pressed && !longSent &&
        uint32_t(now - pressedAt) >= LONG_PRESS_MS) {
      longSent = true;
      haveTap = false;
      return Event::LongPress;
    }
    return Event::None;
  }

private:
  bool armed = false;
  bool rawPressed = false;
  bool stablePressed = false;
  bool longSent = false;
  bool haveTap = false;
  uint32_t rawChangedAt = 0;
  uint32_t pressedAt = 0;
  uint32_t lastTapAt = 0;
};

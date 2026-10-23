// Host test: c++ -std=c++17 test/input_gesture.cpp -o /tmp/elato-input-test && /tmp/elato-input-test
#include "../src/InputGesture.h"
#include "../src/TouchInput.h"
#include <cassert>
#include <cstdio>
using Event = InputGesture::Event;

int main() {
  InputGesture input;
  assert(input.update(false, 40) == Event::None);
  // Contact bounce must not generate a tap.
  assert(input.update(true, 100) == Event::None);
  assert(input.update(false, 110) == Event::None);
  assert(input.update(false, 150) == Event::None);
  // A short press is emitted on debounced release, without a double-click wait.
  input.update(true, 200); input.update(true, 240);
  input.update(false, 300);
  assert(input.update(false, 340) == Event::ShortPress);
  input.update(true, 400); input.update(true, 440);
  input.update(false, 490);
  assert(input.update(false, 530) == Event::DoubleTap);
  // A long hold emits sleep once, and does not also emit a short/double tap.
  input.update(true, 1000); input.update(true, 1040);
  assert(input.update(true, 2539) == Event::None);
  assert(input.update(true, 2540) == Event::LongPress);
  assert(input.update(true, 3000) == Event::None);
  input.update(false, 3100);
  assert(input.update(false, 3140) == Event::None);
  // Releasing the press that woke the device must not trigger an action.
  InputGesture wake;
  assert(wake.update(true, 500) == Event::None);
  assert(wake.update(true, 3000) == Event::None);
  wake.update(false, 3100);
  assert(wake.update(false, 3140) == Event::None);
  wake.update(true, 4000); wake.update(true, 4040);
  wake.update(false, 4100);
  assert(wake.update(false, 4140) == Event::ShortPress);
  // Two separated taps are not mistaken for a double tap.
  wake.update(true, 5000); wake.update(true, 5040);
  wake.update(false, 5100);
  assert(wake.update(false, 5140) == Event::ShortPress);
  // millis() wraps after ~49 days; held-input timing must still work.
  InputGesture wrap;
  wrap.update(false, 0xfffff000u);
  wrap.update(true, 0xffffff00u); wrap.update(true, 0xffffff28u);
  assert(wrap.update(true, uint32_t(0xffffff28u + 1500u)) == Event::LongPress);
  TouchInput touch;
  touch.configure(30000);
  assert(!touch.sample(30000));
  assert(!touch.sample(39000));
  assert(touch.sample(41000));
  assert(touch.sample(39000)); // hysteresis: do not release at the press boundary
  assert(!touch.sample(34000));
  assert(touch.pressDelta() == 10000); // hardware sleep threshold is a delta
  touch.configure(0);
  assert(!touch.sample(0));
  std::puts("Input gestures passed: debounce, short press, double tap, long hold, wake release, rollover");
}

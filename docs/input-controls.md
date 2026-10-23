# Touch and button controls

Both input modes use the same debounced gesture handler:

- **Short tap while the AI speaks:** mute the amplifier, discard queued PCM,
  cancel the current response, and return to listening.
- **Hold for 1.5 seconds:** request deep sleep; finish entering sleep once the
  input has stayed released for 500 ms.
- **Double tap:** keep the sleep shortcut. When speaking, the first tap can
  interrupt and the second requests sleep.
- **Press/touch while asleep:** wake. Release the waking input before any new
  gesture can be recognized, so a held wake press cannot put it straight back
  to sleep.

The PCB's on-board input is the **TOUCH pad on GPIO2**, not a tactile button.
SW1 selects the power source. `TOUCH_MODE` in
`firmware-arduino/src/Config.h` is now enabled for that board. Comment it only
when using a physical active-low button on GPIO2. These are alternative
configurations of the same GPIO, not two simultaneously enabled inputs.

Touch mode calibrates an untouched raw baseline on cold boot; leave the pad
alone for the first second. Press is baseline + one-third (minimum delta 1000);
release uses half that delta to provide hysteresis. The baseline is retained
across touch deep-sleep wakes so a held waking finger is not calibrated as
the untouched pad. The S3 hardware sleep threshold is the delta from its
benchmark, rather than the absolute raw threshold used while awake.

Wake uses a level-sensitive source. Entering sleep while the wake input is
still asserted can cause immediate wake. The firmware now requires a stable
release before sleep and explicitly configures the button RTC pull-up, then
releases RTC ownership on wake. Serial output reports the wake cause and logs
sleep requests, release waiting, actual sleep entry, and speech interruption.

The local OpenAI bridge now cancels active generation, trims unheard audio,
and suppresses late audio/completion for an interrupted response, following
[OpenAI's WebSocket interruption guidance](https://developers.openai.com/api/docs/guides/realtime-conversations).
The transport also ignores frames from a disconnected or replaced socket,
preventing late packets from touching cleared conversation state during sleep.

## Checks

```sh
cd firmware-arduino
c++ -std=c++17 test/input_gesture.cpp -o /tmp/elato-input-test
/tmp/elato-input-test
pio run
cd ../frontend-nextjs
node --test tests/*.test.cjs
```

The gesture tests cover bounce, short taps, double taps, one long event per
hold, ignoring a held wake input, and clock rollover. Offline OpenAI tests
cover cancellation, trimming bounds, late frames/completion, the next response,
and socket teardown. Both button and touch firmware configurations were built.

On the PCB, test a short tap during speech, a long hold followed by release,
remaining asleep without touching it, waking with a fresh press, and double-tap
sleep. Capacitive threshold suitability and physical gestures require a hands-on
test; compiling both modes does not establish touch sensitivity on an enclosure.

## Connected board observations — 24 October 2026

The initial button-mode build was flashed with serial hashes verified. The live log recorded
`Input short press: interrupted speech at 4917 ms`, then `Input double tap: sleep
requested`, stable-release waiting, and `Entering deep sleep; press the input to
wake.` No immediate wake appeared in that observation period, but the user
subsequently reported intermittent waking. PCB source inspection then confirmed
the on-board capacitive input had been running in the wrong mode, so touch mode
was enabled with calibrated thresholds. Opening the USB serial monitor also
caused a normal reset (wake cause 0); subsequent tests must keep the same serial
connection open so monitor resets are not confused with touch wake events.
The OpenAI bridge
received the interrupt and the Deno process remained alive after the board's
normal WebSocket disconnect. Long-hold timing is covered by the shared gesture
test; physical touch sensitivity remains a separate hands-on check.

Initial button-mode application SHA-256 (superseded by the touch build):
`bba15cc67cb079c7c384f73ab16a4f1eb733672d11ce1424692e09a3e837a265`

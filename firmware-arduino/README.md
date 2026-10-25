# ESP32 WebSocket Audio Client

For more details, visit the [Elato Firmware Docs](https://www.elatoai.com/docs/blog/firmware).

For an ESP32-S3-WROOM-1-N16R8, use `pio run -e esp32-s3-n16r8 -t upload`.
This enables the module's 8 MB OPI PSRAM, providing memory for audio decoding
alongside TLS connections and battery telemetry. The default `esp32-s3-devkitc-1`
environment keeps PSRAM disabled for boards without it.

For a physical button, leave `TOUCH_MODE` commented out in `src/Config.h`.
Choose exactly one deployment mode there. Cached registration tokens are scoped
to the selected backend; switching backends refreshes registration while keeping
saved Wi-Fi settings.

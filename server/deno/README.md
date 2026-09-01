# Elato AI WebSocket Server (Deno)

For more details, visit the [Elato Deno Server Docs](https://www.elatoai.com/docs/blog/edge-server).

## Boson Higgs Realtime

The Deno server supports Boson's raw Realtime WebSocket API through
`models/boson.ts`. Set a voice row's `provider` to `boson` and its `name` to
one of the preset voices: `chloe`, `eleanor`, `nora`, `jake`, `marcus`,
`oliver`, `yujin`, or `jiho`.

Add the following environment variable before starting the server:

```dotenv
BOSON_API_KEY=<BOSON_API_KEY>
```

Optional overrides are `BOSON_REALTIME_MODEL` (default `higgs-realtime`),
`BOSON_TRANSCRIPTION_MODEL` (default `higgs-stt-3.1`), and
`BOSON_TEMPERATURE` (default `0.3`). The bridge accepts the ESP32's binary
audio stream, uses tuned Boson server VAD for the firmware's continuous mic
stream, packetizes Boson's 24 kHz PCM output as Opus, forwards transcripts,
and supports interruption and end-session events. Tune far-field detection
with `BOSON_ESP32_VAD_THRESHOLD` and `BOSON_ESP32_VAD_SILENCE_MS`.

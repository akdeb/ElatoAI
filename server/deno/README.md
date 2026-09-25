# Elato AI WebSocket Server (Deno)

For more details, visit the [Elato Deno Server Docs](https://www.elatoai.com/docs/blog/edge-server).

## OpenAI GPT-Live

`models/openai-live.ts` bridges OpenAI's GPT-Live model. GPT-Live is **not** a
Realtime model: it runs on the separate Live API
(`wss://api.openai.com/v1/live/sessions`), so it is exposed as its own provider
rather than a model swap within `openai`. Set a personality's `provider` to
`openai-live`.

```
OPENAI_API_KEY=<OPENAI_API_KEY>
OPENAI_LIVE_MODEL=gpt-live-1
OPENAI_LIVE_BACKEND_MODEL=gpt-5.6-luna
```

GPT-Live delegates reasoning and tool use to a backend Responses model, named
by `OPENAI_LIVE_BACKEND_MODEL`; `end_session` is registered there and its result
is returned with `response.item.create` followed by `response.create`.

Two behaviours differ from the Realtime bridge and are worth knowing:

- **Turn boundaries are inferred.** GPT-Live emits no output-audio-done event,
  so a spoken turn is considered finished after `OPENAI_LIVE_TURN_IDLE_MS` (900
  by default) of output-audio silence. Audio arriving after that simply opens
  the next turn, so a long mid-turn pause costs a re-announced turn rather than
  a stuck session. Raise it if responses get clipped.
- **The device stays half duplex.** The ESP32 has no acoustic echo
  cancellation, so a full-duplex mic would feed GPT-Live its own voice and it
  would interrupt itself. Input is muted server-side
  (`session.input_audio.mute`) for the duration of each spoken turn, which also
  means the device cannot barge in mid-response.

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

## xAI Grok Voice

The Grok bridge uses xAI's current Realtime Voice API with
`grok-voice-latest`, lowercase voice identifiers, `grok-transcribe`, and
server-side VAD. Set `XAI_API_KEY` and use the `grok` personality provider.

The ESP32 defaults are tuned for a far-field microphone. Override them with
`GROK_ESP32_VAD_THRESHOLD`, `GROK_ESP32_VAD_PREFIX_PADDING_MS`, and
`GROK_ESP32_VAD_SILENCE_MS` if needed. Because server VAD owns turn detection,
the bridge streams microphone audio continuously and does not manually commit
the firmware's `end_of_speech` instruction.

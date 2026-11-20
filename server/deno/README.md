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

## Mistral (Voxtral STT + Mistral LLM + Voxtral TTS)

`models/mistral.ts` runs a cascaded, streaming pipeline. Set a voice row's
`provider` to `mistral` and its `name` to a Voxtral TTS `voice_id`, and set
`MISTRAL_API_KEY`. Turn detection is an energy VAD on the server; STT sockets are
pre-warmed, the LLM streams, and text is sent to TTS clause-by-clause.

Optional overrides: `MISTRAL_LLM_MODEL` (default `mistral-large-4`),
`MISTRAL_REASONING_EFFORT` (default `none`; `high` enables thinking, much slower),
`MISTRAL_STT_MODEL`, `MISTRAL_TTS_MODEL`, `MISTRAL_TTS_VOICE`,
`MISTRAL_TTS_SAMPLE_RATE` (default `24000`), `MISTRAL_VAD_THRESHOLD` (min level, default `120`), `MISTRAL_VAD_SNR` (default `3`), `MISTRAL_PLAYBACK_LEAD_MS` (default `800`)
and `MISTRAL_VAD_SILENCE_MS` (default `550`).

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

## AssemblyAI (STT + LLM Gateway + TTS)

`models/assemblyai-pipeline.ts` runs a streaming cascade on one `ASSEMBLYAI_API_KEY`
and is selected by the `assemblyai-pipeline` personality provider:

```
ESP32 --16 kHz PCM--> STT (wss://streaming.assemblyai.com/v3/ws)
                          | end_of_turn
                          v
                  LLM Gateway (SSE, /v1/chat/completions)
                          | sentences
                          v
        TTS (wss://tts.us.assemblyai.com/v1/ws) --24 kHz PCM--> Opus --> ESP32
```

It uses only Deno's built-in `WebSocket` and `fetch` for the upstream hops. The STT and TTS
sessions open when the call starts and stay open, mic audio is forwarded without
resampling, TTS audio goes straight to Opus, and sentences are sent to TTS with
`Generate` + `Flush` while the LLM is still writing. `INTERRUPT` aborts the LLM request, sends TTS
`Cancel` and drops queued audio. Each turn logs `end_of_turn->llm_first_token` and
`end_of_turn->first_audio` latencies.

The character's voice is a TTS `voice_id` such as `aai-kyla` (a bare `kyla` works too).
Optional settings: `ASSEMBLYAI_STT_MODEL`, `ASSEMBLYAI_LLM_MODEL`, `ASSEMBLYAI_REGION`
(`us` or `eu`), `ASSEMBLYAI_MIN_TURN_SILENCE` / `ASSEMBLYAI_MAX_TURN_SILENCE`,
`ASSEMBLYAI_LLM_MAX_TOKENS`, `ASSEMBLYAI_LLM_TEMPERATURE`, `ASSEMBLYAI_LLM_REASONING_EFFORT`,
`ASSEMBLYAI_PLAYBACK_LEAD_MS`, and `ASSEMBLYAI_BARGE_IN=True` (only for hardware with echo
cancellation).

### AssemblyAI Voice Agent API (deprecated)

`models/assemblyai.ts` bridges AssemblyAI's managed Voice Agent API
(`wss://agents.assemblyai.com/v1/ws`) under the `assemblyai` provider. AssemblyAI is
sunsetting that API in favor of the STT / LLM Gateway / TTS products, so use
`assemblyai-pipeline` for new characters. The file is kept until the API shuts down.

## xAI Grok Voice

The Grok bridge uses xAI's current Realtime Voice API with
`grok-voice-latest`, lowercase voice identifiers, `grok-transcribe`, and
server-side VAD. Set `XAI_API_KEY` and use the `grok` personality provider.

The ESP32 defaults are tuned for a far-field microphone. Override them with
`GROK_ESP32_VAD_THRESHOLD`, `GROK_ESP32_VAD_PREFIX_PADDING_MS`, and
`GROK_ESP32_VAD_SILENCE_MS` if needed. Because server VAD owns turn detection,
the bridge streams microphone audio continuously and does not manually commit
the firmware's `end_of_speech` instruction.

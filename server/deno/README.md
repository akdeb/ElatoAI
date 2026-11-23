# Elato AI WebSocket Server (Deno)

For more details, visit the [Elato Deno Server Docs](https://www.elatoai.com/docs/blog/edge-server).

## OpenAI GPT-Live

`models/realtime/openai-live.ts` bridges OpenAI's GPT-Live model. GPT-Live is **not** a
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
`models/realtime/boson.ts`. Set a voice row's `provider` to `boson` and its `name` to
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

## Pipeline (STT → LLM → TTS, any mix)

`models/pipeline/` runs a streaming cascade where each stage is a plug-in, so any
speech-to-text works with any LLM and any text-to-speech. A character uses provider
`pipeline` and stores `stt_provider`, `llm_provider` + `llm_model`, and `tts_provider` +
`oai_voice` (the voice id on that TTS provider).

```
ESP32 --16 kHz PCM--> stt/  (owns turn detection)
                        | end of turn
                        v
                      llm/  (streams; tool calls run between rounds)
                        | sentences, first one at its first clause
                        v
                      tts/  --24 kHz PCM--> Opus --> ESP32
```

| Stage | `assemblyai` | `mistral` |
|---|---|---|
| `stt/` | Streaming STT, server-side turn detection | Voxtral Realtime + local energy VAD |
| `llm/openai-compatible.ts` | LLM Gateway: any model id (Claude, GPT, Gemini, Gemma, …) | Mistral Large 4 |
| `tts/` | TTS-1 over one WebSocket (library or cloned voice ids) | Voxtral TTS, one streaming request per sentence |

`runner.ts` is the shared turn loop: history, tool rounds, barge-in, playback pacing, and
`end_of_turn->first_audio` latency logs. Tool packs live in `tools/` (`plant.ts` is the
soil-sensor demo, on with `PIPELINE_PLANT_MODE=True`). To add a provider, implement the
`SttProvider`, `LlmProvider` or `TtsProvider` interface in `types.ts` and register it in
`index.ts`. Characters saved as `assemblyai` or `mistral` before the split run every stage
on that provider.

Keys: `ASSEMBLYAI_API_KEY`, `MISTRAL_API_KEY` (only for the stages you use).
AssemblyAI options: `ASSEMBLYAI_STT_MODEL`, `ASSEMBLYAI_LLM_MODEL` (default when a character
has no `llm_model`), `ASSEMBLYAI_TTS_VOICE` (overrides every character's voice, e.g. a clone
id), `ASSEMBLYAI_REGION` (`us`/`eu`), `ASSEMBLYAI_MIN_TURN_SILENCE` / `ASSEMBLYAI_MAX_TURN_SILENCE`,
`ASSEMBLYAI_LLM_MAX_TOKENS`, `ASSEMBLYAI_LLM_TEMPERATURE`, `ASSEMBLYAI_LLM_REASONING_EFFORT`.
Mistral options: `MISTRAL_LLM_MODEL` (default `mistral-large-4`), `MISTRAL_REASONING_EFFORT`
(default `low`), `MISTRAL_STT_MODEL`, `MISTRAL_TTS_MODEL`, `MISTRAL_TTS_VOICE`,
`MISTRAL_VAD_THRESHOLD`, `MISTRAL_VAD_SNR`, `MISTRAL_VAD_SILENCE_MS`.
Runner options: `PIPELINE_PLAYBACK_LEAD_MS` (default `800`), `PIPELINE_OPUS_BITRATE` (default
`48000`), `PIPELINE_BARGE_IN=True` (only for hardware with echo cancellation).

## xAI Grok Voice

The Grok bridge uses xAI's current Realtime Voice API with
`grok-voice-latest`, lowercase voice identifiers, `grok-transcribe`, and
server-side VAD. Set `XAI_API_KEY` and use the `grok` personality provider.

The ESP32 defaults are tuned for a far-field microphone. Override them with
`GROK_ESP32_VAD_THRESHOLD`, `GROK_ESP32_VAD_PREFIX_PADDING_MS`, and
`GROK_ESP32_VAD_SILENCE_MS` if needed. Because server VAD owns turn detection,
the bridge streams microphone audio continuously and does not manually commit
the firmware's `end_of_speech` instruction.

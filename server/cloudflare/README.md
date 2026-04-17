# server-cloudflare

Cloudflare Workers + Durable Objects voice backend for Elato.

This starts with one ESP32-compatible websocket path:

- `/ws/esp32`

The route is backed by a Durable Object that preserves the Elato device control protocol.

## Current stack

- STT: `@cf/openai/whisper`
- LLM: OpenAI Chat Completions
- TTS: `@cf/deepgram/aura-1`

## Local setup

1. Install dependencies

```bash
npm install
```

2. Copy `.dev.vars.example` to `.dev.vars` and fill in your keys.

3. Run locally

```bash
npm run dev
```

## Notes

- ESP32 clients should connect to:

```text
wss://<worker-domain>/ws/esp32
```

- Auth is intentionally left out of this iteration. Add your own auth check in the Worker route before using this in production.
- This backend now targets the current Elato ESP32 control protocol first:
  `auth`, `AUDIO.COMMITTED`, `RESPONSE.CREATED`, binary audio frames, `RESPONSE.COMPLETE`, and `SESSION.END`.
- It does not currently use `@cloudflare/voice`; the Durable Object owns the websocket session directly so the firmware protocol stays explicit.
- The ESP32 route now packetizes Cloudflare TTS output into Opus frames before sending binary websocket packets, matching the same 24kHz mono / 120ms framing shape used by `server/deno`.
- The remaining gap is operational, not transport-level: this prototype still has placeholder auth / DB comments and has not been load-tested against long-running device sessions yet.

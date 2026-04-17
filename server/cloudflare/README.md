# server/cloudflare

Cloudflare Workers + Durable Objects backend for Elato's ESP32 realtime voice flow.

This server keeps the existing Elato device protocol and routes audio through Cloudflare-hosted services:

- STT: Cloudflare Workers AI via `@cloudflare/voice`
- LLM: OpenAI Chat Completions
- TTS: Cloudflare Workers AI Deepgram Aura
- Transport: WebSocket + Opus packetization for ESP32

If you are new to the overall project, start with the root README first:

- `/Users/akashdeepdeb/Desktop/Projects/ElatoAI/README.md`
- `/Users/akashdeepdeb/Desktop/Projects/ElatoAI/server/README.md`

## What This Server Does

This backend is meant to be an alternative to the Deno edge server, not a separate firmware protocol.

The ESP32 still talks to the same Elato-style control surface:

- `auth`
- `AUDIO.COMMITTED`
- `RESPONSE.CREATED`
- binary audio frames
- `RESPONSE.COMPLETE`
- `SESSION.END`

Public route:

```text
/ws/esp32
```

Health check:

```text
/healthz
```

## Current Layout

```text
server/cloudflare/
├── models/
│   ├── llm.ts
│   ├── session.ts
│   ├── stt.ts
│   └── tts.ts
├── src/
│   ├── index.ts
│   ├── opus.ts
│   ├── prompt.ts
│   └── types.ts
├── package.json
└── wrangler.toml
```

## How It Works

1. The ESP32 opens a secure websocket to `/ws/esp32`.
2. The Worker creates a fresh Durable Object session for that websocket.
3. The server sends the Elato `auth` payload.
4. The server triggers the first assistant turn.
5. LLM output is synthesized to audio.
6. Audio is packetized into Opus frames and streamed back to the ESP32.
7. After playback, the ESP32 goes back to listening.
8. Incoming mic audio is fed to the STT session for the next turn.

## Prerequisites

You need:

- Node.js 22+
- npm
- a Cloudflare account with Workers enabled
- a Workers AI binding
- an OpenAI API key for the LLM path

## Local Development

### 1. Install dependencies

```bash
cd /Users/akashdeepdeb/Desktop/Projects/ElatoAI/server/cloudflare
npm install
```

### 2. Create local env vars

Copy the example file:

```bash
cp .dev.vars.example .dev.vars
```

Then fill in the values you actually need.

Typical local file:

```env
OPENAI_API_KEY=...
ELATO_OPENAI_MODEL=gpt-4.1-mini
ELATO_OPENAI_SYSTEM_PROMPT=You are a friendly toy character.
ELATO_OPENAI_FIRST_MESSAGE=Say hello first in one short sentence.
```

Notes:

- `JWT_SECRET_KEY` is not currently required for the stripped-down iteration unless you wire auth back in.
- Do not commit real secrets.

### 3. Run locally

```bash
npm run dev
```

This uses:

```bash
wrangler dev --ip 0.0.0.0 --port 8787
```

So local access is typically:

```text
http://<your-lan-ip>:8787/healthz
ws://<your-lan-ip>:8787/ws/esp32
```

For local firmware testing:

- point the ESP32 at your machine's LAN IP, not `0.0.0.0`
- local plain `ws://` is fine for quick testing if your firmware build allows it
- production firmware should use `wss://`

## Deploying to Cloudflare

### 1. Set Worker secrets

Set the runtime secrets in Cloudflare:

- `OPENAI_API_KEY`
- optionally `ELATO_OPENAI_MODEL`
- optionally `ELATO_OPENAI_SYSTEM_PROMPT`
- optionally `ELATO_OPENAI_FIRST_MESSAGE`

### 2. Deploy

```bash
cd /Users/akashdeepdeb/Desktop/Projects/ElatoAI/server/cloudflare
npm run deploy
```

### 3. Point the ESP32 at the Worker

Example production route:

```text
wss://<your-worker>.workers.dev/ws/esp32
```

## Durable Object Model

The current setup uses one fresh Durable Object per websocket voice session.

That is the sensible default for realtime voice apps because:

- each call/session gets isolated state
- reconnects do not inherit stale memory
- turn state is easier to reason about
- cleanup is straightforward

This is what the Worker does in `/Users/akashdeepdeb/Desktop/Projects/ElatoAI/server/cloudflare/src/index.ts`.

## Migrations

This backend already has a Durable Object rename migration in `/Users/akashdeepdeb/Desktop/Projects/ElatoAI/server/cloudflare/wrangler.toml`:

- `ElatoOpenAiVoiceAgent` -> `ElatoVoiceSession`

If you rename the DO again later, add another migration instead of just changing the class name.

## Common Commands

Typecheck:

```bash
npm run typecheck
```

Local dev:

```bash
npm run dev
```

Deploy:

```bash
npm run deploy
```

## Operational Notes

A few things matter in practice:

- Rapid reconnect testing can trigger Workers AI rate limits, especially on TTS.
- If you redeploy while a websocket session is active, Cloudflare may log:
  `This script has been upgraded. Please send a new request to connect to the new version.`
  That is expected during deploy churn.
- If the ESP32 flips into speaking briefly and then falls back, check whether TTS actually produced audio or hit a `429`.
- If STT does not advance turns, inspect the STT provider logs first before debugging firmware state.

## Current Limitations

This Cloudflare backend is still a pragmatic project backend, not a polished platform product.

Current caveats:

- auth is still intentionally stubbed out with comments
- DB writes are still placeholders
- Workers AI rate limiting can affect repeated testing
- the stack is still operationally rough compared with the more mature Deno path

## Recommended Files To Read

If you are modifying this backend, read these first:

- `/Users/akashdeepdeb/Desktop/Projects/ElatoAI/server/cloudflare/src/index.ts`
- `/Users/akashdeepdeb/Desktop/Projects/ElatoAI/server/cloudflare/models/session.ts`
- `/Users/akashdeepdeb/Desktop/Projects/ElatoAI/server/cloudflare/models/stt.ts`
- `/Users/akashdeepdeb/Desktop/Projects/ElatoAI/server/cloudflare/models/llm.ts`
- `/Users/akashdeepdeb/Desktop/Projects/ElatoAI/server/cloudflare/models/tts.ts`
- `/Users/akashdeepdeb/Desktop/Projects/ElatoAI/firmware-arduino/src/Audio.cpp`
- `/Users/akashdeepdeb/Desktop/Projects/ElatoAI/firmware-arduino/src/Config.cpp`

## Relationship To Other Servers

Elato currently includes multiple backend paths:

- `/Users/akashdeepdeb/Desktop/Projects/ElatoAI/server/deno`
- `/Users/akashdeepdeb/Desktop/Projects/ElatoAI/server/cloudflare`
- `/Users/akashdeepdeb/Desktop/Projects/ElatoAI/server/fastapi`

Use Cloudflare when you want:

- Workers + Durable Objects
- Cloudflare-hosted STT/TTS
- a stateful edge session model

Use Deno when you want:

- the most battle-tested Elato path right now
- direct provider integrations already working in production

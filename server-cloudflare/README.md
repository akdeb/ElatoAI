# server-cloudflare

Cloudflare Workers + Durable Objects voice backend for Elato.

This starts with one model path:

- `/ws/openai`

Under the hood that route is rewritten into a Durable Object agent using Cloudflare Agents SDK and `@cloudflare/voice`.

## Current stack

- STT: `WorkersAIFluxSTT`
- LLM: OpenAI Chat Completions
- TTS: `WorkersAITTS`

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

- Browser / Next.js clients should connect with a token query param, for example:

```text
wss://<worker-domain>/ws/openai?token=<jwt>&session=<session-id>
```

- ESP32 clients can keep sending `Authorization: Bearer <token>` headers, but this backend is currently built around Cloudflare Voice's browser-style PCM websocket flow, not the existing Elato ESP32 control protocol.
- For ESP32 parity, we will likely need a Cloudflare-side shim or a separate ESP32-specific route.

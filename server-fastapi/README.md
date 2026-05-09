## ElatoAI: Realtime Voice AI Models on FastAPI

`server-fastapi` is the simplest self-hosted Elato backend for people who want a normal Python server instead of an edge runtime.

Use this if you want:

- a FastAPI server you can run on your own machine or VM
- a classic `STT -> LLM -> TTS` voice pipeline
- a smaller provider surface that is easy to understand
- the same ESP32 transport shape as the rest of Elato

If you are new to the project, read these first:

- `/Users/akashdeepdeb/Desktop/Projects/ElatoAI/README.md`
- `/Users/akashdeepdeb/Desktop/Projects/ElatoAI/server/README.md`

## The Simple Provider Set

To keep onboarding straightforward, the classic FastAPI route is centered around a small set of providers.

### LLM

- `openai`
- `claude`
- `gemini`
- `grok`

### STT

- `deepgram`
- `whisper`

### TTS

- `elevenlabs`
- `cartesia`
- `deepgram`
- `openai`

The code still uses the `models/llm`, `models/stt`, and `models/tts` layout, but the active registry is intentionally trimmed so the default experience stays simple.

## Default Setup

The default classic route is:

- STT: `deepgram`
- LLM: `openai`
- TTS: `elevenlabs`

That gives people one obvious path to get running before they start swapping providers.

## Project Layout

```text
server-fastapi/
├── bot.py
├── classic_route.py
├── esp32_transport.py
├── server.py
├── env.example
└── models/
    ├── llm/
    ├── stt/
    └── tts/
```

## How The FastAPI Server Fits Into Elato

Elato has three backend options right now:

- `/Users/akashdeepdeb/Desktop/Projects/ElatoAI/server/deno`
- `/Users/akashdeepdeb/Desktop/Projects/ElatoAI/server/cloudflare`
- `/Users/akashdeepdeb/Desktop/Projects/ElatoAI/server-fastapi`

A clean way to think about them is:

- `Deno`: edge-first, mature provider integrations
- `Cloudflare`: Workers + Durable Objects + Workers AI
- `FastAPI`: normal Python server, easy to self-host, easy to reason about

## Quick Start

### 1. Create or activate your Python environment

Use whatever you prefer. If you already use `uv`, that is a good default.

### 2. Install dependencies

This repo uses `pyproject.toml`, so install from that environment rather than a `requirements.txt` file.

With `uv`:

```bash
cd /Users/akashdeepdeb/Desktop/Projects/ElatoAI/server-fastapi
uv sync
```

Or with plain pip in your venv:

```bash
cd /Users/akashdeepdeb/Desktop/Projects/ElatoAI/server-fastapi
pip install -e .
```

### 3. Create your env file

Copy the example values from:

- `/Users/akashdeepdeb/Desktop/Projects/ElatoAI/server-fastapi/env.example`

Minimum example for the default route:

```env
DEEPGRAM_API_KEY=your_deepgram_api_key
OPENAI_API_KEY=your_openai_api_key
ELEVENLABS_API_KEY=your_elevenlabs_api_key

CURRENT_VOICE_ROUTE=classic
CLASSIC_STT_PROVIDER=deepgram
CLASSIC_LLM_PROVIDER=openai
CLASSIC_TTS_PROVIDER=elevenlabs

ESP32_INPUT_SAMPLE_RATE=16000
BROWSER_INPUT_SAMPLE_RATE=16000
AUDIO_OUTPUT_SAMPLE_RATE=24000
PIPELINE_AUDIO_IN_SAMPLE_RATE=16000
PIPELINE_AUDIO_OUT_SAMPLE_RATE=24000

ALLOWED_ORIGINS=*
HOST=0.0.0.0
PORT=7860
```

### 4. Run the server

If you use `uv`:

```bash
cd /Users/akashdeepdeb/Desktop/Projects/ElatoAI/server-fastapi
uv run server.py
```

If you use your activated venv directly:

```bash
cd /Users/akashdeepdeb/Desktop/Projects/ElatoAI/server-fastapi
python server.py
```

### 5. Point your ESP32 at the FastAPI backend

Update the firmware config so your hardware connects to this server instead of the Deno or Cloudflare backend.

The ESP32 route is:

```text
/ws/esp32
```

For browser or Next.js testing, the server also exposes:

- `/ws/browser`
- `/ws/nextjs`

## How Provider Selection Works

The classic route reads three env vars:

- `CLASSIC_STT_PROVIDER`
- `CLASSIC_LLM_PROVIDER`
- `CLASSIC_TTS_PROVIDER`

So changing providers is just an env change.

Examples:

### OpenAI + Deepgram + ElevenLabs

```env
CLASSIC_STT_PROVIDER=deepgram
CLASSIC_LLM_PROVIDER=openai
CLASSIC_TTS_PROVIDER=elevenlabs
```

### Whisper + Claude + Cartesia

```env
CLASSIC_STT_PROVIDER=whisper
CLASSIC_LLM_PROVIDER=claude
CLASSIC_TTS_PROVIDER=cartesia
```

### Deepgram + Gemini + OpenAI TTS

```env
CLASSIC_STT_PROVIDER=deepgram
CLASSIC_LLM_PROVIDER=gemini
CLASSIC_TTS_PROVIDER=openai
```

## Unified Experience Across Elato

A simple way to keep the product understandable is:

- keep the Next.js frontend focused on character creation and device management
- keep the ESP32 firmware focused on one transport protocol
- let users choose one backend runtime:
  - Deno
  - Cloudflare
  - FastAPI
- inside each backend, expose the same conceptual knobs:
  - `STT`
  - `LLM`
  - `TTS`

That means the hardware story stays stable:

- one firmware
- one websocket-style mental model
- three server deployment choices

The cleanest unification strategy is not “every backend supports every provider.”
It is:

- every backend should expose the same categories
- each backend should have one recommended default stack
- advanced users can swap providers later

## Recommended Defaults

If you want a simple opinionated experience for users, keep one default combo per backend.

Suggested defaults:

- `Deno`: OpenAI realtime
- `Cloudflare`: Workers AI STT/TTS + OpenAI LLM
- `FastAPI`: Deepgram + OpenAI + ElevenLabs

That gives users one obvious starting point without taking away flexibility.

## Important Files

If you want to change the FastAPI backend, start here:

- `/Users/akashdeepdeb/Desktop/Projects/ElatoAI/server-fastapi/server.py`
- `/Users/akashdeepdeb/Desktop/Projects/ElatoAI/server-fastapi/classic_route.py`
- `/Users/akashdeepdeb/Desktop/Projects/ElatoAI/server-fastapi/esp32_transport.py`
- `/Users/akashdeepdeb/Desktop/Projects/ElatoAI/server-fastapi/models/llm/__init__.py`
- `/Users/akashdeepdeb/Desktop/Projects/ElatoAI/server-fastapi/models/stt/__init__.py`
- `/Users/akashdeepdeb/Desktop/Projects/ElatoAI/server-fastapi/models/tts/__init__.py`

## Current Notes

- The filesystem still contains many scaffolded provider modules from the earlier broader experiment.
- The active provider registry is now intentionally much smaller.
- That means the codebase stays extensible, but the user-facing default path stays simple.

## ElatoAI: Realtime Voice AI Models on FastAPI

`server/fastapi` is the simplest self-hosted Elato backend for people who want a normal Python server instead of an edge runtime.

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
server/fastapi/
├── bot.py
├── voice_pipeline.py
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
- `/Users/akashdeepdeb/Desktop/Projects/ElatoAI/server/fastapi`

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
cd /Users/akashdeepdeb/Desktop/Projects/ElatoAI/server/fastapi
uv sync
```

Or with plain pip in your venv:

```bash
cd /Users/akashdeepdeb/Desktop/Projects/ElatoAI/server/fastapi
pip install -e .
```

### 3. Create your env file

Copy the example values from:

- `/Users/akashdeepdeb/Desktop/Projects/ElatoAI/server/fastapi/env.example`

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
cd /Users/akashdeepdeb/Desktop/Projects/ElatoAI/server/fastapi
uv run server.py
```

If you use your activated venv directly:

```bash
cd /Users/akashdeepdeb/Desktop/Projects/ElatoAI/server/fastapi
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

Pipecat handles the runtime orchestration for us:

- STT turns incoming audio into transcripts
- the LLM receives conversation context and streams text back
- TTS turns that streamed text into audio

In other words, Pipecat stitches the pipeline together, but Elato still needs to provide:

- the provider selection UX
- the transport protocol for ESP32
- the environment-variable contract for API keys
- the recommended defaults

That is why this FastAPI backend now has a simple provider catalog and validation layer in:

- `/Users/akashdeepdeb/Desktop/Projects/ElatoAI/server/fastapi/models/providers.py`

This lets the app answer questions like:

- which LLMs do we support?
- which key does `deepgram` require?
- can the server start with the currently selected stack?

### Required API Keys By Provider

The current simple provider map is:

- `openai` LLM: `OPENAI_API_KEY`
- `claude` LLM: `ANTHROPIC_API_KEY`
- `gemini` LLM: `GEMINI_API_KEY`
- `grok` LLM: `XAI_API_KEY`
- `deepgram` STT: `DEEPGRAM_API_KEY`
- `whisper` STT: no external API key required
- `elevenlabs` TTS: `ELEVENLABS_API_KEY`
- `cartesia` TTS: `CARTESIA_API_KEY`
- `deepgram` TTS: `DEEPGRAM_API_KEY`
- `openai` TTS: `OPENAI_API_KEY`

At startup, the server now validates the selected `CLASSIC_*_PROVIDER` values and fails early if the required keys are missing.

### Provider Modules

Each supported provider now has its own module file so the layout is easy to understand:

- `/Users/akashdeepdeb/Desktop/Projects/ElatoAI/server/fastapi/models/llm/openai.py`
- `/Users/akashdeepdeb/Desktop/Projects/ElatoAI/server/fastapi/models/llm/anthropic.py`
- `/Users/akashdeepdeb/Desktop/Projects/ElatoAI/server/fastapi/models/llm/gemini.py`
- `/Users/akashdeepdeb/Desktop/Projects/ElatoAI/server/fastapi/models/llm/grok.py`
- `/Users/akashdeepdeb/Desktop/Projects/ElatoAI/server/fastapi/models/stt/deepgram.py`
- `/Users/akashdeepdeb/Desktop/Projects/ElatoAI/server/fastapi/models/stt/whisper.py`
- `/Users/akashdeepdeb/Desktop/Projects/ElatoAI/server/fastapi/models/tts/elevenlabs.py`
- `/Users/akashdeepdeb/Desktop/Projects/ElatoAI/server/fastapi/models/tts/cartesia.py`
- `/Users/akashdeepdeb/Desktop/Projects/ElatoAI/server/fastapi/models/tts/deepgram.py`
- `/Users/akashdeepdeb/Desktop/Projects/ElatoAI/server/fastapi/models/tts/openai.py`

Under the hood, these modules delegate to Pipecat service implementations. We keep that wiring thin on purpose so users mostly think in terms of:

- `STT`
- `LLM`
- `TTS`

not internal service classes.

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

## What This Looks Like In A UI

For Elato, the cleanest UI model is:

1. user picks a backend runtime:
   - `deno`
   - `cloudflare`
   - `fastapi`
2. user picks one option in each category:
   - `stt`
   - `llm`
   - `tts`
3. UI shows which API keys are required
4. backend validates the selection before starting a session

This FastAPI server now exposes a simple provider catalog at:

- `/providers`

So your Next.js frontend can eventually fetch the available providers and render a model picker without hardcoding everything in the UI.

## Recommended Defaults

If you want a simple opinionated experience for users, keep one default combo per backend.

Suggested defaults:

- `Deno`: OpenAI realtime
- `Cloudflare`: Workers AI STT/TTS + OpenAI LLM
- `FastAPI`: Deepgram + OpenAI + ElevenLabs

That gives users one obvious starting point without taking away flexibility.

## Important Files

If you want to change the FastAPI backend, start here:

- `/Users/akashdeepdeb/Desktop/Projects/ElatoAI/server/fastapi/server.py`
- `/Users/akashdeepdeb/Desktop/Projects/ElatoAI/server/fastapi/voice_pipeline.py`
- `/Users/akashdeepdeb/Desktop/Projects/ElatoAI/server/fastapi/esp32_transport.py`
- `/Users/akashdeepdeb/Desktop/Projects/ElatoAI/server/fastapi/models/llm/__init__.py`
- `/Users/akashdeepdeb/Desktop/Projects/ElatoAI/server/fastapi/models/stt/__init__.py`
- `/Users/akashdeepdeb/Desktop/Projects/ElatoAI/server/fastapi/models/tts/__init__.py`

## Current Notes

- The filesystem still contains many scaffolded provider modules from the earlier broader experiment.
- The active provider registry is now intentionally much smaller.
- That means the codebase stays extensible, but the user-facing default path stays simple.

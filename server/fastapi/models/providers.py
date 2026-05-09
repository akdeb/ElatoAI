"""Provider metadata and validation for the simple FastAPI voice stack."""

from __future__ import annotations

import os
from dataclasses import asdict, dataclass
from typing import Literal


ProviderCategory = Literal["llm", "stt", "tts"]


@dataclass(frozen=True)
class ProviderSpec:
    name: str
    category: ProviderCategory
    module: str
    env: tuple[str, ...] = ()
    aliases: tuple[str, ...] = ()
    description: str = ""


PROVIDER_SPECS: dict[ProviderCategory, dict[str, ProviderSpec]] = {
    "llm": {
        "openai": ProviderSpec(
            name="openai",
            category="llm",
            module="models.llm.openai",
            env=("OPENAI_API_KEY",),
            description="OpenAI chat-completions compatible LLM.",
        ),
        "claude": ProviderSpec(
            name="claude",
            category="llm",
            module="models.llm.anthropic",
            env=("ANTHROPIC_API_KEY",),
            aliases=("anthropic",),
            description="Anthropic Claude via Pipecat's AnthropicLLMService.",
        ),
        "gemini": ProviderSpec(
            name="gemini",
            category="llm",
            module="models.llm.gemini",
            env=("GEMINI_API_KEY",),
            aliases=("google_gemini",),
            description="Google Gemini text model via Pipecat.",
        ),
        "grok": ProviderSpec(
            name="grok",
            category="llm",
            module="models.llm.grok",
            env=("XAI_API_KEY",),
            description="xAI Grok via Pipecat.",
        ),
    },
    "stt": {
        "deepgram": ProviderSpec(
            name="deepgram",
            category="stt",
            module="models.stt.deepgram",
            env=("DEEPGRAM_API_KEY",),
            description="Deepgram real-time transcription service.",
        ),
        "whisper": ProviderSpec(
            name="whisper",
            category="stt",
            module="models.stt.whisper",
            description="Local Whisper transcription service with no external API key.",
        ),
    },
    "tts": {
        "elevenlabs": ProviderSpec(
            name="elevenlabs",
            category="tts",
            module="models.tts.elevenlabs",
            env=("ELEVENLABS_API_KEY",),
            description="ElevenLabs streaming TTS service.",
        ),
        "cartesia": ProviderSpec(
            name="cartesia",
            category="tts",
            module="models.tts.cartesia",
            env=("CARTESIA_API_KEY",),
            description="Cartesia TTS service.",
        ),
        "deepgram": ProviderSpec(
            name="deepgram",
            category="tts",
            module="models.tts.deepgram",
            env=("DEEPGRAM_API_KEY",),
            description="Deepgram Aura TTS service.",
        ),
        "openai": ProviderSpec(
            name="openai",
            category="tts",
            module="models.tts.openai",
            env=("OPENAI_API_KEY",),
            description="OpenAI text-to-speech service.",
        ),
    },
}


def get_provider_registry(category: ProviderCategory) -> dict[str, str]:
    specs = PROVIDER_SPECS[category]
    registry: dict[str, str] = {}
    for key, spec in specs.items():
        registry[key] = spec.module
        for alias in spec.aliases:
            registry[alias] = spec.module
    return registry


def get_provider_spec(category: ProviderCategory, provider_name: str) -> ProviderSpec:
    normalized = provider_name.strip().lower()
    for key, spec in PROVIDER_SPECS[category].items():
        if normalized == key or normalized in spec.aliases:
            return spec
    available = ", ".join(sorted(PROVIDER_SPECS[category]))
    raise ValueError(f"Unknown {category} provider '{provider_name}'. Available providers: {available}")


def validate_provider_env(category: ProviderCategory, provider_name: str) -> None:
    spec = get_provider_spec(category, provider_name)
    missing = [env_key for env_key in spec.env if not os.getenv(env_key)]
    if missing:
        raise RuntimeError(
            f"Selected {category} provider '{spec.name}' requires environment variables: "
            + ", ".join(missing)
        )


def validate_classic_provider_stack() -> dict[str, str]:
    selected = {
        "stt": os.getenv("CLASSIC_STT_PROVIDER", "deepgram").strip().lower(),
        "llm": os.getenv("CLASSIC_LLM_PROVIDER", "openai").strip().lower(),
        "tts": os.getenv("CLASSIC_TTS_PROVIDER", "elevenlabs").strip().lower(),
    }
    for category, provider_name in selected.items():
        validate_provider_env(category, provider_name)  # type: ignore[arg-type]
    return selected


def get_provider_catalog() -> dict[str, list[dict[str, object]]]:
    catalog: dict[str, list[dict[str, object]]] = {}
    for category, providers in PROVIDER_SPECS.items():
        catalog[category] = []
        for spec in providers.values():
            payload = asdict(spec)
            payload["env"] = list(spec.env)
            payload["aliases"] = list(spec.aliases)
            catalog[category].append(payload)
    return catalog

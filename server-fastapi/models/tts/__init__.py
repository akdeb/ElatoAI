"""TTS provider registry."""

from __future__ import annotations

from models._provider_loader import load_provider_factory

TTS_REGISTRY = {
    "cartesia": "models.tts.cartesia",
    "deepgram": "models.tts.deepgram",
    "elevenlabs": "models.tts.elevenlabs",
    "openai": "models.tts.openai",
}


def create_tts_service(provider_name: str, **kwargs):
    factory = load_provider_factory(TTS_REGISTRY, provider_name, "TTS")
    return factory(**kwargs)

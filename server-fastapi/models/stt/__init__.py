"""STT provider registry."""

from __future__ import annotations

from models._provider_loader import load_provider_factory

STT_REGISTRY = {
    "deepgram": "models.stt.deepgram",
    "openai": "models.stt.openai",
    "whisper": "models.stt.whisper",
}


def create_stt_service(provider_name: str, **kwargs):
    factory = load_provider_factory(STT_REGISTRY, provider_name, "STT")
    return factory(**kwargs)

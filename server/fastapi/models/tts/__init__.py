"""TTS provider registry."""

from __future__ import annotations

from models._provider_loader import load_provider_factory
from models.providers import get_provider_registry

TTS_REGISTRY = get_provider_registry("tts")


def create_tts_service(provider_name: str, **kwargs):
    factory = load_provider_factory(TTS_REGISTRY, provider_name, "TTS")
    return factory(**kwargs)

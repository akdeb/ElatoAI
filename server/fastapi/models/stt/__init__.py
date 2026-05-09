"""STT provider registry."""

from __future__ import annotations

from models._provider_loader import load_provider_factory
from models.providers import get_provider_registry

STT_REGISTRY = get_provider_registry("stt")


def create_stt_service(provider_name: str, **kwargs):
    factory = load_provider_factory(STT_REGISTRY, provider_name, "STT")
    return factory(**kwargs)

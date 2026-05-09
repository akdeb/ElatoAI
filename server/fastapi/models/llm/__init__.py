"""LLM provider registry."""

from __future__ import annotations

from models._provider_loader import load_provider_factory
from models.providers import get_provider_registry

LLM_REGISTRY = get_provider_registry("llm")


def create_llm_service(provider_name: str, **kwargs):
    factory = load_provider_factory(LLM_REGISTRY, provider_name, "LLM")
    return factory(**kwargs)

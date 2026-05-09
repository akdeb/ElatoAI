"""LLM provider registry."""

from __future__ import annotations

from models._provider_loader import load_provider_factory

LLM_REGISTRY = {
    "claude": "models.llm.anthropic",
    "anthropic": "models.llm.anthropic",
    "gemini": "models.llm.google_gemini",
    "google_gemini": "models.llm.google_gemini",
    "google_vertex_ai": "models.llm.google_vertex_ai",
    "grok": "models.llm.grok",
    "openai": "models.llm.openai",
}


def create_llm_service(provider_name: str, **kwargs):
    factory = load_provider_factory(LLM_REGISTRY, provider_name, "LLM")
    return factory(**kwargs)

"""MiniMax LLM provider.

MiniMax exposes an OpenAI-compatible chat-completions API, so we reuse
Pipecat's ``OpenAILLMService`` and only point it at the MiniMax base URL.
This mirrors how Pipecat wires other OpenAI-compatible vendors (Grok, Groq,
DeepSeek, ...) and keeps the provider module thin.

Docs: https://platform.minimax.io/docs/api-reference/text-openai-api
"""

from __future__ import annotations

import os

from pipecat.services.openai.llm import OpenAILLMService

# Overseas (default) OpenAI-compatible endpoint. Mainland China users can set
# MINIMAX_BASE_URL to https://api.minimaxi.com/v1 instead.
DEFAULT_BASE_URL = "https://api.minimax.io/v1"
DEFAULT_MODEL = "MiniMax-M3"


def create_service(**kwargs):
    """Create an OpenAI-compatible Pipecat LLM service backed by MiniMax."""
    api_key = kwargs.get("api_key") or os.getenv("MINIMAX_API_KEY")
    base_url = kwargs.get("base_url") or os.getenv("MINIMAX_BASE_URL") or DEFAULT_BASE_URL
    model = kwargs.get("model") or DEFAULT_MODEL

    settings_kwargs: dict[str, object] = {"model": model}
    if kwargs.get("system_instruction") is not None:
        settings_kwargs["system_instruction"] = kwargs["system_instruction"]

    # MiniMax requires temperature in the (0.0, 1.0] range and rejects 0, so we
    # default to 1.0 instead of leaving it unset / passing 0.
    temperature = kwargs.get("temperature")
    settings_kwargs["temperature"] = 1.0 if temperature is None else temperature

    return OpenAILLMService(
        api_key=api_key,
        base_url=base_url,
        settings=OpenAILLMService.Settings(**settings_kwargs),
    )

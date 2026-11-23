"""Atlas Cloud OpenAI-compatible LLM provider."""

from __future__ import annotations

import os

from pipecat.services.openai.llm import OpenAILLMService

DEFAULT_BASE_URL = "https://api.atlascloud.ai/v1"
DEFAULT_MODEL = "deepseek-ai/deepseek-v4-pro"


def create_service(**kwargs):
    api_key = kwargs.pop("api_key", None) or os.getenv("ATLASCLOUD_API_KEY")
    base_url = kwargs.pop("base_url", None) or os.getenv("ATLASCLOUD_BASE_URL", DEFAULT_BASE_URL)
    model = kwargs.pop("model", None) or os.getenv("ATLASCLOUD_MODEL", DEFAULT_MODEL)
    system_instruction = kwargs.pop("system_instruction", None)
    settings = kwargs.pop("settings", None) or OpenAILLMService.Settings(
        model=model,
        system_instruction=system_instruction,
    )

    return OpenAILLMService(
        api_key=api_key,
        base_url=base_url,
        settings=settings,
        **kwargs,
    )

"""Generic runtime provider loader for autodiscovered Pipecat services."""

from __future__ import annotations

import importlib
import inspect
import os
import pkgutil
import re
from collections.abc import Callable

TOKEN_CASE_MAP = {
    "ai": "AI",
    "aws": "AWS",
    "llm": "LLM",
    "openai": "OpenAI",
    "stt": "STT",
    "tts": "TTS",
    "xai": "xAI",
}


def _normalize(value: str) -> str:
    value = value.strip().lower().replace("&", "and")
    value = re.sub(r"[()/\-]+", "_", value)
    value = re.sub(r"[^a-z0-9_]+", "_", value)
    value = re.sub(r"_+", "_", value)
    return value.strip("_")


def _provider_tokens(provider_label: str) -> list[str]:
    normalized = _normalize(provider_label)
    aliases = {
        "aws": "amazon",
        "wizper": "whisper",
        "speech_to_text": "stt",
        "text_to_speech": "tts",
    }
    tokens = [token for token in normalized.split("_") if token]
    expanded = []
    for token in tokens:
        expanded.append(token)
        if token in aliases:
            expanded.append(aliases[token])
    return list(dict.fromkeys(expanded))


def _iter_matching_modules(provider_label: str, category: str) -> list[str]:
    try:
        import pipecat.services  # type: ignore
    except ModuleNotFoundError as exc:
        raise NotImplementedError(
            "Pipecat is not installed in the current Python environment, so provider "
            f"'{provider_label}' cannot be wired yet."
        ) from exc

    tokens = _provider_tokens(provider_label)
    category_token = category.lower()
    matches = []
    for module_info in pkgutil.walk_packages(
        pipecat.services.__path__, pipecat.services.__name__ + "."
    ):
        name = module_info.name.lower()
        if category_token not in name:
            continue
        score = 0
        for token in tokens:
            if token in name:
                score += 2
        if name.endswith(f".{category_token}"):
            score += 4
        if score > 0:
            matches.append((score, name))

    matches.sort(key=lambda item: (-item[0], item[1]))
    return [name for _, name in matches]


def _candidate_class_names(provider_label: str, category: str) -> list[str]:
    category_suffix = f"{category.upper()}Service"
    words = [part for part in _normalize(provider_label).split("_") if part]
    pascal = "".join(TOKEN_CASE_MAP.get(word, word.capitalize()) for word in words)
    variants = [
        f"{pascal}{category_suffix}",
    ]
    if "openai" in words and "responses" in words:
        variants.insert(0, "OpenAIResponsesLLMService")
    if "aws" in words and "polly" in words:
        variants.insert(0, "PollyTTSService")
    if "aws" in words and "transcribe" in words:
        variants.insert(0, "TranscribeSTTService")
    return list(dict.fromkeys(variants))


def _candidate_env_keys(provider_label: str, category: str) -> list[str]:
    base = _normalize(provider_label).upper()
    category_upper = category.upper()
    service_specific = f"{base}_{category_upper}_API_KEY"
    generic = f"{base}_API_KEY"
    return [service_specific, generic]


def _build_settings(service_cls, kwargs: dict[str, object]):
    settings_cls = getattr(service_cls, "Settings", None)
    if settings_cls is None:
        return None

    settings_signature = inspect.signature(settings_cls)
    settings_kwargs = {}
    for key in ("system_instruction", "model", "voice", "language", "temperature"):
        if key in kwargs and key in settings_signature.parameters and kwargs[key] is not None:
            settings_kwargs[key] = kwargs[key]

    if not settings_kwargs:
        return None
    return settings_cls(**settings_kwargs)


def _instantiate_service(service_cls, provider_label: str, category: str, kwargs: dict[str, object]):
    signature = inspect.signature(service_cls)
    init_kwargs = {}

    if "api_key" in signature.parameters:
        api_key = kwargs.get("api_key")
        if api_key is None:
            for env_key in _candidate_env_keys(provider_label, category):
                if os.getenv(env_key):
                    api_key = os.getenv(env_key)
                    break
        if api_key is not None:
            init_kwargs["api_key"] = api_key

    settings = _build_settings(service_cls, kwargs)
    if settings is not None and "settings" in signature.parameters:
        init_kwargs["settings"] = settings

    for key in ("model", "voice", "base_url", "sample_rate"):
        if key in kwargs and key in signature.parameters and kwargs[key] is not None:
            init_kwargs[key] = kwargs[key]

    return service_cls(**init_kwargs)


def autodiscovered_provider_factory(provider_label: str, category: str) -> Callable:
    def create_service(**_: object):
        kwargs = dict(_)
        module_errors = []

        for module_name in _iter_matching_modules(provider_label, category):
            try:
                module = importlib.import_module(module_name)
            except Exception as exc:
                module_errors.append(f"{module_name}: {exc}")
                continue

            for class_name in _candidate_class_names(provider_label, category):
                service_cls = getattr(module, class_name, None)
                if service_cls is None:
                    continue
                try:
                    return _instantiate_service(service_cls, provider_label, category, kwargs)
                except Exception as exc:
                    module_errors.append(f"{module_name}.{class_name}: {exc}")

            for attribute_name in dir(module):
                if not attribute_name.endswith(f"{category.upper()}Service"):
                    continue
                service_cls = getattr(module, attribute_name)
                if not inspect.isclass(service_cls):
                    continue
                try:
                    return _instantiate_service(service_cls, provider_label, category, kwargs)
                except Exception as exc:
                    module_errors.append(f"{module_name}.{attribute_name}: {exc}")

        details = "; ".join(module_errors[:10]) if module_errors else "no matching Pipecat modules found"
        raise NotImplementedError(
            f"{category} provider '{provider_label}' could not be resolved from the installed "
            f"Pipecat services. Details: {details}"
        )

    return create_service


# Backwards-compatible alias for earlier scaffolding.
unsupported_provider_factory = autodiscovered_provider_factory

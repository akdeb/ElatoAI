"""Helpers for loading provider factories by normalized name."""

from __future__ import annotations

import importlib
import re
from collections.abc import Callable


def normalize_provider_name(name: str) -> str:
    normalized = name.strip().lower()
    normalized = normalized.replace("&", "and")
    normalized = re.sub(r"[()/\-]+", "_", normalized)
    normalized = re.sub(r"[^a-z0-9_]+", "_", normalized)
    normalized = re.sub(r"_+", "_", normalized)
    return normalized.strip("_")


def load_provider_factory(
    registry: dict[str, str],
    provider_name: str,
    category: str,
) -> Callable:
    key = normalize_provider_name(provider_name)
    module_path = registry.get(key)
    if not module_path:
        available = ", ".join(sorted(registry))
        raise ValueError(
            f"Unknown {category} provider '{provider_name}'. Available providers: {available}"
        )

    module = importlib.import_module(module_path)
    return module.create_service

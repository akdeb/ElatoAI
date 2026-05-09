"""xAI Grok LLM provider."""

from models._autodiscover import autodiscovered_provider_factory

create_service = autodiscovered_provider_factory("Grok", "LLM")

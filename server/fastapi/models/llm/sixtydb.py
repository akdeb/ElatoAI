"""60db LLM provider.

60db exposes an OpenAI-compatible /v1/chat/completions endpoint, so when
mounted as the LLM, the cleanest Pipecat integration is OpenAILLMService
pointed at base_url=https://api.60db.ai/v1 with model="60db-tiny".

Until that wiring lands directly, the autodiscovered factory surfaces a
clear NotImplementedError. The full 60db pipeline (STT+LLM+TTS) is wired
end-to-end in server/deno/models/sixtydb.ts.
"""

from models._autodiscover import autodiscovered_provider_factory

create_service = autodiscovered_provider_factory("Sixtydb", "LLM")

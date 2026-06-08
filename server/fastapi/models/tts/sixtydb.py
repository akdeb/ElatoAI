"""60db TTS provider.

See models/stt/sixtydb.py for the stub-vs-Pipecat note. The Deno server
holds the full 60db WS implementation in server/deno/models/sixtydb.ts.
"""

from models._autodiscover import autodiscovered_provider_factory

create_service = autodiscovered_provider_factory("Sixtydb", "TTS")

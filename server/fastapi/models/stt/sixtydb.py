"""60db STT provider.

Pipecat doesn't ship a stock 60db service yet, so this stub surfaces a
clear NotImplementedError via the autodiscovery loader. When a Pipecat
service named SixtydbSTTService lands (or a custom class is added under
pipecat.services.sixtydb), this file picks it up automatically.

For the Deno server, a fully-orchestrated 60db pipeline already exists at
server/deno/models/sixtydb.ts.
"""

from models._autodiscover import autodiscovered_provider_factory

create_service = autodiscovered_provider_factory("Sixtydb", "STT")

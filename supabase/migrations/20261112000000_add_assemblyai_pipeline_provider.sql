-- AssemblyAI pipeline provider (Streaming STT + LLM Gateway + Text-to-Speech)
ALTER TABLE personalities
DROP CONSTRAINT IF EXISTS personalities_provider_check;

ALTER TABLE personalities
ADD CONSTRAINT personalities_provider_check
CHECK (provider IN ('openai', 'openai-live', 'gemini', 'grok', 'elevenlabs', 'hume', 'boson', 'mistral', 'assemblyai', 'assemblyai-pipeline'));

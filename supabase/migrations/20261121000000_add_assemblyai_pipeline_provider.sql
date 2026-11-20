-- AssemblyAI streaming pipeline (STT + LLM Gateway + TTS). The managed Voice Agent API
-- ('assemblyai') is being sunset by AssemblyAI; new characters should use this provider.
ALTER TABLE personalities
DROP CONSTRAINT IF EXISTS personalities_provider_check;

ALTER TABLE personalities
ADD CONSTRAINT personalities_provider_check
CHECK (provider IN ('openai', 'openai-live', 'gemini', 'grok', 'elevenlabs', 'hume', 'boson', 'mistral', 'assemblyai', 'assemblyai-pipeline'));

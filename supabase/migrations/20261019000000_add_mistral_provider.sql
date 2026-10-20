-- Mistral runs as a cascaded pipeline (Voxtral Realtime STT -> Mistral LLM -> Voxtral TTS)
ALTER TABLE personalities
DROP CONSTRAINT IF EXISTS personalities_provider_check;

ALTER TABLE personalities
ADD CONSTRAINT personalities_provider_check
CHECK (provider IN ('openai', 'openai-live', 'gemini', 'grok', 'elevenlabs', 'hume', 'boson', 'mistral'));

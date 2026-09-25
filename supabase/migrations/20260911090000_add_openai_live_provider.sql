-- GPT-Live runs on OpenAI's Live API rather than the Realtime API, so it is a
-- separate provider from 'openai' and not a model swap within it.
ALTER TABLE personalities
DROP CONSTRAINT IF EXISTS personalities_provider_check;

ALTER TABLE personalities
ADD CONSTRAINT personalities_provider_check
CHECK (provider IN ('openai', 'openai-live', 'gemini', 'grok', 'elevenlabs', 'hume', 'boson'));

ALTER TABLE personalities
DROP CONSTRAINT IF EXISTS personalities_provider_check;

ALTER TABLE personalities
ADD CONSTRAINT personalities_provider_check
CHECK (provider IN ('openai', 'gemini', 'grok', 'elevenlabs', 'hume', 'boson'));

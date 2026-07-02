-- Extend the personalities.provider CHECK constraint to accept '60db'.
-- 60db.ai is wired as a full STT + LLM + TTS pipeline (server/deno/models/sixtydb.ts,
-- server/cloudflare/models/sixtydb.ts, server/fastapi/models/{stt,tts,llm}/sixtydb.py).

ALTER TABLE personalities DROP CONSTRAINT IF EXISTS personalities_provider_check;

ALTER TABLE personalities
    ADD CONSTRAINT personalities_provider_check
    CHECK (provider IN ('openai', 'gemini', 'grok', 'elevenlabs', 'hume', '60db'));

-- AssemblyAI is now only the streaming pipeline (Streaming STT -> LLM Gateway -> TTS-1).
-- The managed Voice Agent API is removed, and the pipeline takes over the plain
-- 'assemblyai' provider name.
--
-- 1. Pipeline characters pick their LLM per character.
ALTER TABLE personalities
ADD COLUMN IF NOT EXISTS llm_model text;

COMMENT ON COLUMN personalities.llm_model IS
  'Pipeline characters only: LLM Gateway model id. NULL = the server default (ASSEMBLYAI_LLM_MODEL).';

-- 2. Free the name: drop the constraint before rewriting rows.
ALTER TABLE personalities
DROP CONSTRAINT IF EXISTS personalities_provider_check;

-- 3. Voice Agent characters move to the pipeline. Their voices (alba, eve, ...) are not
--    TTS-1 library voices, so they get the default TTS-1 voice.
UPDATE personalities
SET oai_voice = 'aai-kyla'
WHERE provider = 'assemblyai';

-- 4. Pipeline characters take the plain name.
UPDATE personalities
SET provider = 'assemblyai'
WHERE provider = 'assemblyai-pipeline';

ALTER TABLE personalities
ADD CONSTRAINT personalities_provider_check
CHECK (provider IN ('openai', 'openai-live', 'gemini', 'grok', 'elevenlabs', 'hume', 'boson', 'mistral', 'assemblyai'));

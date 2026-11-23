-- Pipeline characters pick each stage separately: any speech-to-text, any LLM, any TTS.
-- They use provider 'pipeline'; the stages live in their own columns.
ALTER TABLE personalities
ADD COLUMN IF NOT EXISTS stt_provider text,
ADD COLUMN IF NOT EXISTS llm_provider text,
ADD COLUMN IF NOT EXISTS tts_provider text;

COMMENT ON COLUMN personalities.stt_provider IS 'Pipeline characters: speech-to-text provider (assemblyai | mistral).';
COMMENT ON COLUMN personalities.llm_provider IS 'Pipeline characters: LLM provider (assemblyai = LLM Gateway | mistral).';
COMMENT ON COLUMN personalities.llm_model IS 'Pipeline characters: model id on llm_provider. NULL = that provider''s default.';
COMMENT ON COLUMN personalities.tts_provider IS 'Pipeline characters: text-to-speech provider (assemblyai | mistral); the voice is oai_voice.';

ALTER TABLE personalities
DROP CONSTRAINT IF EXISTS personalities_provider_check;

-- Single-provider pipeline characters become 'pipeline' with every stage on that provider.
UPDATE personalities
SET stt_provider = provider, llm_provider = provider, tts_provider = provider, provider = 'pipeline'
WHERE provider IN ('assemblyai', 'mistral');

ALTER TABLE personalities
ADD CONSTRAINT personalities_provider_check
CHECK (provider IN ('openai', 'openai-live', 'gemini', 'grok', 'elevenlabs', 'hume', 'boson', 'pipeline'));

ALTER TABLE personalities
ADD CONSTRAINT personalities_pipeline_stages_check
CHECK (
  provider <> 'pipeline' OR (
    stt_provider IN ('assemblyai', 'mistral') AND
    llm_provider IN ('assemblyai', 'mistral') AND
    tts_provider IN ('assemblyai', 'mistral')
  )
);

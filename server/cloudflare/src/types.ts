export interface Env {
  AI: Ai;
  JWT_SECRET_KEY: string;
  OPENAI_API_KEY: string;
  TTS_SPEAKER?: string;
  ELATO_OPENAI_MODEL?: string;
  ELATO_OPENAI_SYSTEM_PROMPT?: string;
  ELATO_OPENAI_FIRST_MESSAGE?: string;
  // 60db.ai integration — set TTS_BACKEND="60db" to swap synthesizeSpeech()
  // from Workers AI / Deepgram Aura to 60db's REST /tts-synthesize.
  TTS_BACKEND?: "workers-ai" | "60db";
  SIXTYDB_API_KEY?: string;
  SIXTYDB_VOICE_ID?: string;
  ElatoVoiceSession: DurableObjectNamespace;
}

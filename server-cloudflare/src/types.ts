export interface Env {
  AI: Ai;
  JWT_SECRET_KEY: string;
  OPENAI_API_KEY: string;
  ELATO_OPENAI_MODEL?: string;
  ELATO_OPENAI_SYSTEM_PROMPT?: string;
  ElatoOpenAiVoiceAgent: DurableObjectNamespace;
}

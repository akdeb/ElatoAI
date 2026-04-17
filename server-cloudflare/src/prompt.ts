import type { Env } from "./types";

const DEFAULT_PROMPT =
  "You are an Elato voice companion. Keep responses concise, natural to speak aloud, and friendly for a realtime conversation.";

export function getSystemPrompt(env: Env): string {
  return env.ELATO_OPENAI_SYSTEM_PROMPT?.trim() || DEFAULT_PROMPT;
}

import type { Env } from "./types";

const DEFAULT_PROMPT =
  "You are an Elato voice companion. Keep responses concise, natural to speak aloud, and friendly for a realtime conversation.";

const DEFAULT_FIRST_MESSAGE =
  "Start the conversation now with a short spoken greeting. Introduce yourself naturally in one sentence.";

export function getSystemPrompt(env: Env): string {
  return env.ELATO_OPENAI_SYSTEM_PROMPT?.trim() || DEFAULT_PROMPT;
}

export function getFirstMessagePrompt(env: Env): string {
  return env.ELATO_OPENAI_FIRST_MESSAGE?.trim() || DEFAULT_FIRST_MESSAGE;
}

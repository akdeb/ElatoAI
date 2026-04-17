import type { Env } from "../src/types";
import { getFirstMessagePrompt, getSystemPrompt } from "../src/prompt";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export async function generateOpenAIReply(
  env: Env,
  transcript: string | null,
  history: ChatMessage[],
): Promise<string> {
  if (!env.OPENAI_API_KEY?.trim()) {
    throw new Error("OPENAI_API_KEY is missing");
  }

  const messages: ChatMessage[] = [
    { role: "system", content: getSystemPrompt(env) },
    ...history,
  ];

  if (transcript && transcript.trim().length > 0) {
    messages.push({ role: "user", content: transcript });
  } else {
    messages.push({ role: "user", content: getFirstMessagePrompt(env) });
  }

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: env.ELATO_OPENAI_MODEL || "gpt-4.1-mini",
      messages,
      temperature: 0.7,
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenAI request failed: ${response.status} ${await response.text()}`);
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };

  return (
    data.choices?.[0]?.message?.content?.trim() ||
    "I heard you, but I do not have a response yet."
  );
}

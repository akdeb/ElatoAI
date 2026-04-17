import { Agent } from "agents";
import {
  WorkersAIFluxSTT,
  WorkersAITTS,
  withVoice,
  type VoiceTurnContext,
} from "@cloudflare/voice";

import { getSystemPrompt } from "../src/prompt";
import type { Env } from "../src/types";

const VoiceAgent = withVoice(Agent);

interface OpenAIChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

async function generateOpenAIReply(
  env: Env,
  transcript: string,
  context: VoiceTurnContext,
): Promise<string> {
  const messages: OpenAIChatMessage[] = [
    { role: "system", content: getSystemPrompt(env) },
    ...context.messages
      .filter(
        (message) =>
          (message.role === "user" || message.role === "assistant") &&
          typeof message.content === "string" &&
          message.content.length > 0,
      )
      .map((message) => ({
        role: message.role as "user" | "assistant",
        content: message.content,
      })),
    { role: "user", content: transcript },
  ];

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
    signal: context.signal,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenAI request failed: ${response.status} ${errorText}`);
  }

  const data = (await response.json()) as {
    choices?: Array<{
      message?: {
        content?: string;
      };
    }>;
  };

  return (
    data.choices?.[0]?.message?.content?.trim() ||
    "I heard you, but I do not have a response yet."
  );
}

export class ElatoOpenAiVoiceAgent extends VoiceAgent<Env> {
  transcriber = new WorkersAIFluxSTT(this.env.AI);

  tts = new WorkersAITTS(this.env.AI, {
    model: "@cf/deepgram/aura-1",
    speaker: "asteria",
  });

  async onTurn(
    transcript: string,
    context: VoiceTurnContext,
  ): Promise<string> {
    return generateOpenAIReply(this.env, transcript, context);
  }
}

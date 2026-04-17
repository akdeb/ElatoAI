import type { Env } from "../src/types";

const AUDIO_OUTPUT_SAMPLE_RATE = 24_000;

export async function synthesizeSpeech(env: Env, text: string): Promise<Response> {
  if (!env.AI) {
    throw new Error("Cloudflare AI binding is missing");
  }

  return env.AI.run(
    "@cf/deepgram/aura-2-en",
    {
      text,
      speaker: "asteria",
      encoding: "linear16",
      container: "none",
      sample_rate: AUDIO_OUTPUT_SAMPLE_RATE,
    },
    {
      returnRawResponse: true,
    },
  ) as Promise<Response>;
}

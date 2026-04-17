import { WorkersAIFluxSTT, type TranscriberSession } from "@cloudflare/voice";
import type { Env } from "../src/types";

const STT_SAMPLE_RATE = 16_000;

export function createSttSession(
  env: Env,
  onInterim: (text: string) => void,
  onUtterance: (transcript: string) => void,
): TranscriberSession {
  const transcriber = new WorkersAIFluxSTT(env.AI, {
    sampleRate: STT_SAMPLE_RATE,
    eotTimeoutMs: 1000,
  });

  return transcriber.createSession({
    onInterim: (text) => {
      if (text.trim()) {
        onInterim(text);
      }
    },
    onUtterance: (transcript) => {
      const text = transcript.trim();
      if (text) {
        onUtterance(text);
      }
    },
  });
}

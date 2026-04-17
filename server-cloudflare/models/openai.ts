import { DurableObject } from "cloudflare:workers";
import type { Env } from "../src/types";
import { createOpusPacketizer } from "../src/opus";
import { getSystemPrompt } from "../src/prompt";

const AUDIO_OUTPUT_SAMPLE_RATE = 24_000;

interface OpenAIChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface SessionState {
  history: OpenAIChatMessage[];
}

function createAuthMessage() {
  return {
    type: "auth",
    volume_control: 100,
    pitch_factor: 1,
    is_ota: false,
    is_reset: false,
  };
}

function createServerMessage(msg: string, extra: Record<string, unknown> = {}) {
  return JSON.stringify({
    type: "server",
    msg,
    ...extra,
  });
}

async function transcribePcm(env: Env, audio: Uint8Array): Promise<string> {
  const response = await env.AI.run("@cf/openai/whisper", {
    audio: [...audio],
  }) as { text?: string };

  return response.text?.trim() || "";
}

async function generateOpenAIReply(
  env: Env,
  transcript: string,
  history: OpenAIChatMessage[],
): Promise<string> {
  const messages: OpenAIChatMessage[] = [
    { role: "system", content: getSystemPrompt(env) },
    ...history,
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

async function synthesizeSpeech(env: Env, text: string): Promise<Response> {
  return env.AI.run(
    "@cf/deepgram/aura-1",
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

export class ElatoOpenAiVoiceAgent extends DurableObject<Env> {
  private audioBuffer = new Uint8Array(0);
  private isGenerating = false;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
  }

  private appendAudio(chunk: Uint8Array) {
    const next = new Uint8Array(this.audioBuffer.length + chunk.length);
    next.set(this.audioBuffer, 0);
    next.set(chunk, this.audioBuffer.length);
    this.audioBuffer = next;
  }

  private async loadSessionState(): Promise<SessionState> {
    const stored = await this.ctx.storage.get<SessionState>("session_state");
    return stored || { history: [] };
  }

  private async saveSessionState(state: SessionState) {
    await this.ctx.storage.put("session_state", state);
  }

  private resetBufferedAudio() {
    this.audioBuffer = new Uint8Array(0);
  }

  private async handleTurn(
    websocket: WebSocket,
    opus: Awaited<ReturnType<typeof createOpusPacketizer>>,
  ) {
    const pcm = this.audioBuffer;
    this.resetBufferedAudio();

    if (pcm.byteLength === 0) {
      return;
    }

    websocket.send(createServerMessage("AUDIO.COMMITTED"));

    const transcript = await transcribePcm(this.env, pcm);
    if (!transcript) {
      websocket.send(createServerMessage("RESPONSE.ERROR"));
      return;
    }
    /* Add user transcript DB call here */

    const session = await this.loadSessionState();
    const reply = await generateOpenAIReply(this.env, transcript, session.history);
    session.history.push(
      { role: "user", content: transcript },
      { role: "assistant", content: reply },
    );
    await this.saveSessionState(session);
    /* Add AI transcript DB call here */

    opus.reset();
    websocket.send(createServerMessage("RESPONSE.CREATED"));

    const ttsResponse = await synthesizeSpeech(this.env, reply);
    if (!ttsResponse.ok || !ttsResponse.body) {
      websocket.send(createServerMessage("RESPONSE.ERROR"));
      return;
    }

    const reader = ttsResponse.body.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          opus.push(value);
        }
      }
      opus.flush(true);
      websocket.send(createServerMessage("RESPONSE.COMPLETE", { volume_control: 100 }));
    } finally {
      reader.releaseLock();
    }
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected websocket", { status: 426 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    server.accept();
    const opus = await createOpusPacketizer((packet) => server.send(packet));

    server.send(JSON.stringify(createAuthMessage()));

    server.addEventListener("message", (event) => {
      void this.ctx.blockConcurrencyWhile(async () => {
        if (typeof event.data !== "string") {
          this.appendAudio(new Uint8Array(event.data as ArrayBuffer));
          return;
        }

        const message = JSON.parse(event.data) as {
          type?: string;
          msg?: string;
        };

        if (message.type !== "instruction") {
          return;
        }

        if (message.msg === "end_of_speech") {
          if (this.isGenerating) {
            return;
          }
          this.isGenerating = true;
          try {
            await this.handleTurn(server, opus);
          } catch {
            server.send(createServerMessage("RESPONSE.ERROR"));
          } finally {
            this.isGenerating = false;
          }
          return;
        }

        if (message.msg === "INTERRUPT") {
          this.isGenerating = false;
          this.resetBufferedAudio();
          server.send(createServerMessage("RESPONSE.COMPLETE", { volume_control: 100 }));
          return;
        }

        if (message.msg === "END_SESSION") {
          server.send(createServerMessage("SESSION.END"));
          server.close(1000, "Session ended");
        }
      });
    });

    server.addEventListener("close", () => {
      this.isGenerating = false;
      this.resetBufferedAudio();
      opus.close();
    });

    return new Response(null, { status: 101, webSocket: client });
  }
}

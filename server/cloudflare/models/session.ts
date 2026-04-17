import { DurableObject } from "cloudflare:workers";
import type { Env } from "../src/types";
import { createOpusPacketizer } from "../src/opus";
import { createSttSession } from "./stt";
import { generateOpenAIReply as generateLLMReply, type ChatMessage } from "./llm";
import { synthesizeSpeech } from "./tts";
import type { TranscriberSession } from "@cloudflare/voice";

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

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`;
  }
  return String(error);
}

export class ElatoVoiceSession extends DurableObject<Env> {
  private isGenerating = false;
  private opusPromise: Promise<Awaited<ReturnType<typeof createOpusPacketizer>>> | null = null;
  private hasStartedConversation = false;
  private transcriberSession: TranscriberSession | null = null;
  private currentWebSocket: WebSocket | null = null;
  private history: ChatMessage[] = [];

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
  }

  private resetSessionState() {
    this.isGenerating = false;
    this.hasStartedConversation = false;
    this.currentWebSocket = null;
    this.history = [];
  }

  private getOpusPacketizer(websocket: WebSocket) {
    if (!this.opusPromise) {
      this.opusPromise = createOpusPacketizer((packet) => websocket.send(packet));
    }
    return this.opusPromise;
  }

  private failStartup(websocket: WebSocket, stage: string, error: unknown) {
    console.error(`[cloudflare][startup:${stage}] ${errorMessage(error)}`);
    websocket.send(createServerMessage("RESPONSE.ERROR"));
    websocket.close(1011, "startup_failed");
  }

  private ensureTranscriberSession() {
    if (this.transcriberSession) {
      return;
    }

    this.transcriberSession = createSttSession(
      this.env,
      (text) => {
        console.log(`[cloudflare][stt] interim: ${text}`);
      },
      (text) => {
        void this.ctx.blockConcurrencyWhile(async () => {
          if (!this.currentWebSocket || this.isGenerating) {
            return;
          }

          this.isGenerating = true;
          try {
            await this.handleTranscriptTurn(this.currentWebSocket, text);
          } catch (error) {
            console.error(`[cloudflare][turn] ${errorMessage(error)}`);
            this.currentWebSocket.send(createServerMessage("RESPONSE.ERROR"));
          } finally {
            this.isGenerating = false;
          }
        });
      },
    );

    console.log("[cloudflare][stt] started continuous Flux session");
  }

  private async streamAssistantReply(websocket: WebSocket, reply: string) {
    const opus = await this.getOpusPacketizer(websocket);
    opus.reset();

    const ttsResponse = await synthesizeSpeech(this.env, reply);
    if (!ttsResponse.ok || !ttsResponse.body) {
      console.error(
        `[cloudflare][tts] request failed: ${ttsResponse.status} ${ttsResponse.statusText}`,
      );
      websocket.send(createServerMessage("RESPONSE.ERROR"));
      return;
    }

    const reader = ttsResponse.body.getReader();
    let responseCreatedSent = false;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          if (!responseCreatedSent) {
            websocket.send(createServerMessage("RESPONSE.CREATED"));
            responseCreatedSent = true;
            console.log("[cloudflare][tts] first audio chunk ready");
          }
          opus.push(value);
        }
      }
      if (!responseCreatedSent) {
        console.error("[cloudflare][tts] no audio chunks returned");
        websocket.send(createServerMessage("RESPONSE.ERROR"));
        return;
      }
      opus.flush(true);
      websocket.send(createServerMessage("RESPONSE.COMPLETE", { volume_control: 100 }));
      console.log(`[cloudflare][tts] streamed reply successfully (${reply.length} chars)`);
    } finally {
      reader.releaseLock();
    }
  }

  private async handleTranscriptTurn(websocket: WebSocket, transcript: string) {
    websocket.send(createServerMessage("AUDIO.COMMITTED"));
    console.log(`[cloudflare][stt] transcript: ${transcript}`);
    /* Add user transcript DB call here */

    const reply = await generateLLMReply(this.env, transcript, this.history);
    console.log(`[cloudflare][llm] generated reply (${reply.length} chars)`);
    this.history.push(
      { role: "user", content: transcript },
      { role: "assistant", content: reply },
    );
    /* Add AI transcript DB call here */
    await this.streamAssistantReply(websocket, reply);
  }

  private async startInitialTurn(websocket: WebSocket) {
    if (this.hasStartedConversation || this.isGenerating) {
      return;
    }

    this.hasStartedConversation = true;
    this.isGenerating = true;

    try {
      console.log("[cloudflare][startup] starting initial turn");
      const reply = await generateLLMReply(this.env, null, this.history);
      console.log(`[cloudflare][llm] initial reply (${reply.length} chars)`);
      this.history.push({ role: "assistant", content: reply });
      /* Add AI transcript DB call here */
      await this.streamAssistantReply(websocket, reply);
    } catch (error) {
      this.failStartup(websocket, "initial_turn", error);
    } finally {
      this.isGenerating = false;
    }
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected websocket", { status: 426 });
    }

    this.resetSessionState();

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    server.accept();

    this.currentWebSocket = server;
    this.ensureTranscriberSession();

    server.send(JSON.stringify(createAuthMessage()));
    void this.startInitialTurn(server);

    server.addEventListener("message", (event) => {
      void this.ctx.blockConcurrencyWhile(async () => {
        if (typeof event.data !== "string") {
          if (this.isGenerating || !this.transcriberSession) {
            return;
          }

          const chunk =
            event.data instanceof ArrayBuffer
              ? event.data
              : event.data instanceof Uint8Array
                ? event.data.slice().buffer
                : event.data instanceof Blob
                  ? await event.data.arrayBuffer()
                  : null;

          if (!chunk) {
            console.error(
              `[cloudflare][stt] unsupported binary payload: ${Object.prototype.toString.call(event.data)}`,
            );
            return;
          }

          this.transcriberSession.feed(chunk);
          return;
        }

        const message = JSON.parse(event.data) as {
          type?: string;
          msg?: string;
        };

        if (message.type !== "instruction") {
          return;
        }

        if (message.msg === "INTERRUPT") {
          this.isGenerating = false;
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
      this.resetSessionState();
      this.transcriberSession?.close();
      this.transcriberSession = null;
      if (this.opusPromise) {
        void this.opusPromise.then((opus) => opus.close()).catch(() => {});
        this.opusPromise = null;
      }
    });

    return new Response(null, { status: 101, webSocket: client });
  }
}

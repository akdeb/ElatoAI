/**
 * 60db.ai voice pipeline provider.
 *
 * Unlike the other providers in this folder (openai/gemini/grok/elevenlabs/hume),
 * 60db ships its STT, LLM, and TTS as three separate services. This file
 * orchestrates them into the same realtime conversational surface the other
 * providers expose:
 *
 *   ESP32 PCM16 @ 24kHz ──┐
 *                          ├─▶ wss://api.60db.ai/ws/stt   (linear PCM frames)
 *                          │     ↳ transcription (interim + final)
 *                          │     ↳ speech_started → BARGE-IN: cancel TTS, reset Opus
 *                          │
 *      final transcript ───┼─▶ POST /v1/chat/completions  (SSE stream)
 *                          │     ↳ delta tokens
 *                          │
 *           assistant text ─┴─▶ wss://api.60db.ai/ws/tts  (create→send→flush)
 *                                ↳ audio_chunk (base64 PCM)
 *                                ↳ resample → Opus → ESP32
 *
 * Docs:
 *   https://docs.60db.ai/api-reference/websocket/stt
 *   https://docs.60db.ai/api-reference/llm/chat-completion
 *   https://docs.60db.ai/api-reference/websocket/tts
 */

import { Buffer } from "node:buffer";
import type { RawData } from "npm:@types/ws";
import { addConversation, getDeviceInfo } from "../supabase.ts";
import {
    createOpusPacketizer,
    isDev,
    SAMPLE_RATE,
    sixtyDbApiKey,
} from "../utils.ts";

// ---------- 60db endpoints ----------------------------------------------------

const BASE_HTTP = "https://api.60db.ai";
const BASE_WS = "wss://api.60db.ai";
const STT_WS_PATH = "/ws/stt";
const TTS_WS_PATH = "/ws/tts";
const CHAT_URL = `${BASE_HTTP}/v1/chat/completions`;

// 60db STT supports linear PCM at 16/24/44.1/48 kHz. We feed at 16k (smaller
// frames, faster transcription, plenty for speech). ESP32 PCM @ 24k → 16k.
const STT_SAMPLE_RATE = 16_000;

// 60db TTS speaks PCM via the WebSocket. We ask for 24 kHz so it matches the
// firmware rate and skips resampling on the way out (only base64 decode).
const TTS_SAMPLE_RATE = 24_000;
const TTS_ENCODING = "LINEAR16" as const;

// Default voice when the personality doesn't carry a 60db UUID.
const DEFAULT_60DB_VOICE_ID = "fbb75ed2-975a-40c7-9e06-38e30524a9a1"; // "Zara"

// ---------- helpers -----------------------------------------------------------

/**
 * Linear-interpolation PCM16 mono resampler.
 * Cheapest acceptable for speech in [8k..48k]; identical strategy to
 * elevenlabs.ts so the audio quality bar matches across providers.
 */
function resamplePcm16Mono(
    inputBytes: Buffer,
    fromRate: number,
    toRate: number,
): Buffer {
    if (fromRate === toRate || inputBytes.length === 0) return inputBytes;
    const inputSamples = inputBytes.length / 2;
    const outputSamples = Math.max(1, Math.floor((inputSamples * toRate) / fromRate));
    const output = Buffer.alloc(outputSamples * 2);
    for (let i = 0; i < outputSamples; i++) {
        const srcPos = (i * fromRate) / toRate;
        const l = Math.floor(srcPos);
        const r = Math.min(l + 1, inputSamples - 1);
        const t = srcPos - l;
        const a = inputBytes.readInt16LE(l * 2);
        const b = inputBytes.readInt16LE(r * 2);
        output.writeInt16LE(Math.round(a + (b - a) * t), i * 2);
    }
    return output;
}

function buildWsUrl(path: string, apiKey: string): string {
    const u = new URL(BASE_WS + path);
    u.searchParams.set("apiKey", apiKey);
    return u.toString();
}

function isUuid(value: string | undefined | null): boolean {
    return !!value && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function resolveVoiceId(personality: any): string {
    const cfg = personality?.voice?.config?.config_id ?? personality?.oai_voice;
    return isUuid(cfg) ? cfg : DEFAULT_60DB_VOICE_ID;
}

function safeSend(socket: WebSocket | null, payload: unknown) {
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    try {
        socket.send(typeof payload === "string" ? payload : JSON.stringify(payload));
    } catch (err) {
        console.error("60db: send failed", err);
    }
}

// ---------- main entrypoint ---------------------------------------------------

export const connectTo60db = async ({
    ws,
    payload,
    connectionPcmFile,
    firstMessage,
    systemPrompt,
    closeHandler,
}: ProviderArgs) => {
    const apiKey = sixtyDbApiKey;
    if (!apiKey) {
        ws.send(JSON.stringify({ type: "server", msg: "AUTH.ERROR" }));
        throw new Error("SIXTYDB_API_KEY is missing");
    }

    const { user, supabase } = payload;
    const voiceId = resolveVoiceId(user.personality);

    // Outbound Opus packetizer to the ESP32.
    const opus = createOpusPacketizer((packet) => ws.send(packet));

    // Conversation memory we maintain locally — 60db's chat endpoint supports
    // save_chat + chat_id, but keeping it local keeps the provider behaviour
    // identical to the others (they all reload history from Supabase).
    const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
        { role: "system", content: systemPrompt },
    ];

    let sttSocket: WebSocket | null = null;
    let ttsSocket: WebSocket | null = null;
    let isSttReady = false;
    let isTtsReady = false;
    let activeTtsContextId: string | null = null;
    let assistantTurnInProgress = false;
    let pendingTtsText = ""; // buffer for tokens that arrive before TTS ctx is ready

    // Queue early ESP32 audio while the upstream STT is still connecting.
    const audioQueue: Buffer[] = [];

    // ── ESP32 → server ─────────────────────────────────────────────────────
    const handleClientMessage = async (data: any, isBinary: boolean) => {
        try {
            if (isBinary) {
                if (isDev && connectionPcmFile) await connectionPcmFile.write(data);
                const pcmAt24k = Buffer.from(data);
                const pcmForStt = resamplePcm16Mono(pcmAt24k, SAMPLE_RATE, STT_SAMPLE_RATE);

                if (isSttReady && sttSocket) {
                    // Send as a JSON `audio` frame; 60db also accepts raw binary
                    // (telephony μ-law) but we're on the browser/linear PCM path.
                    safeSend(sttSocket, {
                        type: "audio",
                        audio: pcmForStt.toString("base64"),
                        encoding: "linear",
                        sample_rate: STT_SAMPLE_RATE,
                        timestamp: Date.now(),
                    });
                } else {
                    audioQueue.push(pcmForStt);
                }
            } else {
                const message = JSON.parse(data.toString("utf-8"));
                if (message.type === "instruction") {
                    if (message.msg === "INTERRUPT") {
                        bargeIn("client INTERRUPT");
                    } else if (message.msg === "END_SESSION") {
                        console.log("60db: end session requested by ESP32");
                        sttSocket?.close();
                        ttsSocket?.close();
                    }
                }
            }
        } catch (err) {
            console.error("60db: error handling client message", err);
        }
    };

    ws.on("message", (data: any, isBinary: boolean) => {
        handleClientMessage(data, isBinary);
    });

    ws.on("error", (error: any) => {
        console.error("60db: ESP32 WebSocket error", error);
        cleanup();
    });

    ws.on("close", async (code: number, reason: string) => {
        console.log(`60db: ESP32 ws closed code=${code} reason=${reason}`);
        await closeHandler();
        cleanup();
        if (isDev && connectionPcmFile) {
            connectionPcmFile.close();
        }
    });

    // ── shared cleanup + barge-in ──────────────────────────────────────────
    const cleanup = () => {
        opus.close();
        try { sttSocket?.close(); } catch { /* noop */ }
        try { ttsSocket?.close(); } catch { /* noop */ }
        sttSocket = null;
        ttsSocket = null;
        isSttReady = false;
        isTtsReady = false;
    };

    /**
     * Barge-in: user spoke while the assistant was talking. Cancel the
     * in-flight TTS context, reset the Opus encoder, drop any partial
     * assistant text. The next final transcript will start a fresh turn.
     */
    const bargeIn = (reason: string) => {
        if (!assistantTurnInProgress && !activeTtsContextId) return;
        console.log(`60db: barge-in (${reason})`);
        if (ttsSocket && activeTtsContextId) {
            safeSend(ttsSocket, { close_context: { context_id: activeTtsContextId } });
        }
        activeTtsContextId = null;
        assistantTurnInProgress = false;
        pendingTtsText = "";
        opus.reset();
    };

    // ── 60db TTS: open WS, manage contexts ─────────────────────────────────
    const openTtsSocket = () => {
        const url = buildWsUrl(TTS_WS_PATH, apiKey);
        ttsSocket = new WebSocket(url);
        ttsSocket.binaryType = "arraybuffer";

        ttsSocket.onopen = () => console.log("60db: TTS ws opened");
        ttsSocket.onerror = (e) => console.error("60db: TTS ws error", e);
        ttsSocket.onclose = () => {
            console.log("60db: TTS ws closed");
            isTtsReady = false;
        };

        ttsSocket.onmessage = async (event) => {
            let frame: any;
            try {
                frame = JSON.parse(typeof event.data === "string" ? event.data : Buffer.from(event.data as ArrayBuffer).toString("utf-8"));
            } catch (err) {
                console.error("60db: TTS bad frame", err);
                return;
            }

            if (frame.connection_established) {
                isTtsReady = true;
                console.log("60db: TTS connection_established", frame.connection_established);
                return;
            }
            if (frame.context_created) {
                // Drain any tokens that arrived before context was ready.
                if (pendingTtsText && activeTtsContextId) {
                    safeSend(ttsSocket, {
                        send_text: { context_id: activeTtsContextId, text: pendingTtsText },
                    });
                    pendingTtsText = "";
                }
                return;
            }
            if (frame.audio_chunk?.audioContent) {
                const audio = Buffer.from(frame.audio_chunk.audioContent, "base64");
                // We asked for 24kHz LINEAR16 — no resample needed → straight to Opus.
                if (!assistantTurnInProgress) {
                    assistantTurnInProgress = true;
                    opus.reset();
                    ws.send(JSON.stringify({ type: "server", msg: "RESPONSE.CREATED" }));
                }
                opus.push(audio);
                return;
            }
            if (frame.flush_completed) {
                opus.flush(true);
                if (assistantTurnInProgress) {
                    try {
                        const device = await getDeviceInfo(supabase, user.user_id);
                        ws.send(JSON.stringify({
                            type: "server",
                            msg: "RESPONSE.COMPLETE",
                            volume_control: device?.volume ?? 100,
                        }));
                    } catch (err) {
                        console.error("60db: getDeviceInfo failed", err);
                        ws.send(JSON.stringify({ type: "server", msg: "RESPONSE.COMPLETE" }));
                    }
                }
                assistantTurnInProgress = false;
                return;
            }
            if (frame.context_closed) {
                if (frame.context_closed.context_id === activeTtsContextId) {
                    activeTtsContextId = null;
                }
                return;
            }
            if (frame.error) {
                console.error("60db: TTS error frame", frame.error);
                return;
            }
        };
    };

    const startTtsContext = (): string => {
        const ctxId = crypto.randomUUID();
        activeTtsContextId = ctxId;
        safeSend(ttsSocket, {
            create_context: {
                context_id: ctxId,
                voice_id: voiceId,
                audio_config: {
                    audio_encoding: TTS_ENCODING,
                    sample_rate_hertz: TTS_SAMPLE_RATE,
                },
                speed: 1.0,
                stability: 50,
                similarity: 75,
            },
        });
        return ctxId;
    };

    const pushTtsTokens = (text: string) => {
        if (!text) return;
        if (!activeTtsContextId || !isTtsReady) {
            pendingTtsText += text;
            return;
        }
        safeSend(ttsSocket, {
            send_text: { context_id: activeTtsContextId, text },
        });
    };

    const flushTtsContext = () => {
        if (!activeTtsContextId) return;
        const ctxId = activeTtsContextId;
        safeSend(ttsSocket, { flush_context: { context_id: ctxId } });
        // We deliberately don't close_context here so the same WS can be
        // reused for the next assistant turn (cheaper than reconnecting).
    };

    // ── 60db LLM: SSE chat-completions stream ──────────────────────────────
    const runAssistantTurn = async (userText: string) => {
        if (assistantTurnInProgress) {
            // Already responding — let barge-in handle this case via the STT path.
            return;
        }
        messages.push({ role: "user", content: userText });
        addConversation(supabase, "user", userText, user);

        startTtsContext();

        let assistantText = "";
        try {
            const res = await fetch(CHAT_URL, {
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${apiKey}`,
                    "Content-Type": "application/json",
                    "Accept": "text/event-stream",
                },
                body: JSON.stringify({
                    model: "60db-tiny",
                    messages,
                    stream: true,
                    save_chat: false,
                }),
            });

            if (!res.ok || !res.body) {
                throw new Error(`60db chat HTTP ${res.status}`);
            }

            const reader = res.body.getReader();
            const decoder = new TextDecoder();
            let buffer = "";

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                buffer += decoder.decode(value, { stream: true });

                // SSE frames are separated by \n\n; each frame has one or more
                // `data: …` lines.
                const frames = buffer.split("\n\n");
                buffer = frames.pop() ?? "";
                for (const frame of frames) {
                    for (const line of frame.split("\n")) {
                        if (!line.startsWith("data:")) continue;
                        const payloadStr = line.slice(5).trim();
                        if (!payloadStr || payloadStr === "[DONE]") continue;
                        try {
                            const evt = JSON.parse(payloadStr);
                            const delta = evt?.choices?.[0]?.delta?.content
                                ?? evt?.choices?.[0]?.message?.content
                                ?? "";
                            if (delta) {
                                assistantText += delta;
                                pushTtsTokens(delta);
                            }
                        } catch (err) {
                            console.warn("60db: SSE parse error", err, payloadStr);
                        }
                    }
                }
            }
        } catch (err) {
            console.error("60db: LLM stream failed", err);
            // Fallback: speak a generic apology so the toy isn't silent.
            const fallback = "Sorry — I had a connection hiccup.";
            assistantText = fallback;
            pushTtsTokens(fallback);
        }

        // End of assistant text → trigger synthesis flush.
        if (assistantText) {
            messages.push({ role: "assistant", content: assistantText });
            addConversation(supabase, "assistant", assistantText, user);
        }
        flushTtsContext();
    };

    // ── 60db STT: open WS, drive the conversation ──────────────────────────
    const openSttSocket = () => {
        const url = buildWsUrl(STT_WS_PATH, apiKey);
        sttSocket = new WebSocket(url);

        sttSocket.onopen = () => {
            console.log("60db: STT ws opened");
            // Configure the session. continuous_mode keeps it alive between
            // utterances (required for voicebot UX).
            safeSend(sttSocket, {
                type: "start",
                languages: null,                 // auto-detect across 39 langs
                config: {
                    encoding: "linear",
                    sample_rate: STT_SAMPLE_RATE,
                    utterance_end_ms: 500,
                    continuous_mode: true,
                    interim_results_frequency: 300,
                    audio_enhancement: "adaptive",
                    no_speech_threshold: 0.60,
                },
            });
        };

        sttSocket.onerror = (e) => console.error("60db: STT ws error", e);

        sttSocket.onclose = (e) => {
            console.log(`60db: STT ws closed code=${e.code} reason=${e.reason}`);
            isSttReady = false;
            // Cascade: closing STT ends the session for this device.
            try { ws.close(); } catch { /* noop */ }
        };

        sttSocket.onmessage = (event) => {
            let frame: any;
            try {
                frame = JSON.parse(typeof event.data === "string" ? event.data : Buffer.from(event.data as ArrayBuffer).toString("utf-8"));
            } catch (err) {
                console.error("60db: STT bad frame", err);
                return;
            }

            if (frame.type === "connected") {
                console.log("60db: STT connected", frame.server_info?.model);
                isSttReady = true;
                // Drain queued audio captured while STT was opening.
                while (audioQueue.length) {
                    const buf = audioQueue.shift()!;
                    safeSend(sttSocket, {
                        type: "audio",
                        audio: buf.toString("base64"),
                        encoding: "linear",
                        sample_rate: STT_SAMPLE_RATE,
                        timestamp: Date.now(),
                    });
                }
                // Kick off the first assistant turn so the toy greets the user
                // (matches the OpenAI/Gemini/ElevenLabs flow).
                if (firstMessage?.trim()) {
                    runAssistantTurn(firstMessage);
                }
                return;
            }

            if (frame.type === "speech_started") {
                // User began speaking → barge-in if we're mid-response.
                if (assistantTurnInProgress) bargeIn("speech_started");
                return;
            }

            if (frame.type === "transcription") {
                // Only act on canonical (speech_final) results with real text.
                if (frame.speech_final && frame.text?.trim()) {
                    console.log("60db: user said", frame.text);
                    runAssistantTurn(frame.text.trim());
                }
                return;
            }

            if (frame.type === "session_stopped") {
                console.log("60db: STT session_stopped", frame.billing_summary);
                return;
            }

            if (frame.type === "error") {
                console.error("60db: STT error", frame.error);
                return;
            }
        };
    };

    // ── kick everything off ────────────────────────────────────────────────
    try {
        openTtsSocket();
        openSttSocket();
    } catch (err) {
        console.error("60db: failed to open upstream sockets", err);
        ws.send(JSON.stringify({ type: "server", msg: "RESPONSE.ERROR" }));
        cleanup();
    }
};

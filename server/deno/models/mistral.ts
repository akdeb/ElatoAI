import { Buffer } from "node:buffer";
import type { RawData } from "npm:@types/ws@^8.5.10";
import { WebSocket } from "npm:ws@^8.18.0";
import { addConversation, getDeviceInfo } from "../supabase.ts";
import {
    createOpusPacketizer,
    isDev,
    mistralApiKey,
    SAMPLE_RATE,
} from "../utils.ts";

// Cascaded voice pipeline: Voxtral Realtime (STT) -> Mistral chat (LLM) -> Voxtral TTS.
//
// Latency tricks (borrowed from Pipecat-style pipelines):
//  - the next STT socket is opened ahead of time, so a turn never pays a handshake
//  - audio is streamed to STT while the user is still talking, so the transcript is
//    ready right after end-of-speech
//  - the LLM streams, and text is cut into small chunks (first one at the first
//    clause) that are sent to TTS immediately
//  - TTS requests for later chunks are issued eagerly and buffered, playback stays ordered
//  - barge-in aborts the LLM + TTS requests and drops queued audio
const MISTRAL_API = "https://api.mistral.ai/v1";
const STT_URL = "wss://api.mistral.ai/v1/audio/transcriptions/realtime";
const STT_MODEL = Deno.env.get("MISTRAL_STT_MODEL") || "voxtral-mini-transcribe-realtime-2602";
const STT_DELAY_MS = Number(Deno.env.get("MISTRAL_STT_DELAY_MS") || "200");
const STT_SAMPLE_RATE = 16000;
const LLM_MODEL = Deno.env.get("MISTRAL_LLM_MODEL") || "mistral-small-latest";
const TTS_MODEL = Deno.env.get("MISTRAL_TTS_MODEL") || "voxtral-mini-tts-2603";
const TTS_SAMPLE_RATE = Number(Deno.env.get("MISTRAL_TTS_SAMPLE_RATE") || "24000");
const DEFAULT_TTS_VOICE = Deno.env.get("MISTRAL_TTS_VOICE") || undefined;
const TEMPERATURE = Number(Deno.env.get("MISTRAL_TEMPERATURE") || "0.5");
const MAX_TOKENS = Number(Deno.env.get("MISTRAL_MAX_TOKENS") || "300");

// Energy VAD (the ESP32 streams its mic continuously, so we do turn detection here).
// Speech must exceed max(VAD_MIN_LEVEL, noise floor * VAD_SNR). The floor adapts to the room.
const VAD_MIN_LEVEL = Number(Deno.env.get("MISTRAL_VAD_THRESHOLD") || "120"); // RMS of int16
const VAD_SNR = Number(Deno.env.get("MISTRAL_VAD_SNR") || "3");
const VAD_DEBUG = Deno.env.get("MISTRAL_VAD_DEBUG") === "True";
const VAD_SILENCE_MS = Number(Deno.env.get("MISTRAL_VAD_SILENCE_MS") || "550");
const VAD_MIN_SPEECH_MS = 120;
const VAD_PREROLL_MS = 300;
const MAX_HISTORY_MESSAGES = 24;
// TTS renders much faster than real time; sending it all at once can overrun the
// device's playback buffer. Keep at most this much audio ahead of the playhead.
const PLAYBACK_LEAD_MS = Number(Deno.env.get("MISTRAL_PLAYBACK_LEAD_MS") || "800");

const BYTES_PER_MS = (SAMPLE_RATE * 2) / 1000;

const TOOLS = [{
    type: "function",
    function: {
        name: "end_session",
        description:
            "End the voice session immediately when the user says goodbye, bye, or says they need to leave.",
        parameters: {
            type: "object",
            properties: { reason: { type: "string", description: "Brief reason for ending." } },
        },
    },
}];

const rms = (pcm: Buffer) => {
    const n = pcm.length >> 1;
    if (!n) return 0;
    let sum = 0;
    for (let i = 0; i < n; i++) {
        const s = pcm.readInt16LE(i * 2);
        sum += s * s;
    }
    return Math.sqrt(sum / n);
};

// Mono PCM16 linear-interpolation resampler.
const resample = (input: Buffer, from: number, to: number): Buffer => {
    if (from === to || input.length < 4) return input;
    const inSamples = input.length >> 1;
    const outSamples = Math.floor((inSamples * to) / from);
    const out = Buffer.alloc(outSamples * 2);
    for (let i = 0; i < outSamples; i++) {
        const pos = (i * from) / to;
        const l = Math.floor(pos);
        const r = Math.min(l + 1, inSamples - 1);
        const a = input.readInt16LE(l * 2);
        const b = input.readInt16LE(r * 2);
        out.writeInt16LE(Math.round(a + (b - a) * (pos - l)), i * 2);
    }
    return out;
};

// float32 LE -> int16 LE. `carry` holds bytes of a sample split across chunks.
const makeFloatToPcm16 = () => {
    let carry = Buffer.alloc(0);
    return (chunk: Buffer): Buffer => {
        const all = carry.length ? Buffer.concat([carry, chunk]) : chunk;
        const usable = all.length - (all.length % 4);
        carry = Buffer.from(all.subarray(usable));
        const out = Buffer.alloc(usable / 2);
        for (let i = 0; i < usable / 4; i++) {
            const f = Math.max(-1, Math.min(1, all.readFloatLE(i * 4)));
            out.writeInt16LE(Math.round(f * 32767), i * 2);
        }
        return out;
    };
};

// Small push/pull queue so TTS chunks can be fetched eagerly and consumed in order.
class AsyncQueue<T> {
    private items: T[] = [];
    private waiter: (() => void) | null = null;
    private ended = false;
    push(item: T) {
        this.items.push(item);
        this.wake();
    }
    end() {
        this.ended = true;
        this.wake();
    }
    private wake() {
        this.waiter?.();
        this.waiter = null;
    }
    async *[Symbol.asyncIterator]() {
        while (true) {
            if (this.items.length) {
                yield this.items.shift() as T;
            } else if (this.ended) {
                return;
            } else {
                await new Promise<void>((r) => (this.waiter = r));
            }
        }
    }
}

// Cuts streamed LLM text into speakable chunks. The first chunk is released at the
// first clause (short, to get audio out fast); later ones at sentence ends.
class SentenceChunker {
    private buf = "";
    private first = true;
    push(text: string): string[] {
        this.buf += text;
        const out: string[] = [];
        while (true) {
            const re = this.first ? /[.!?,;:\n]\s/ : /[.!?\n]\s/;
            const minLen = this.first ? 12 : 20;
            const m = re.exec(this.buf.slice(minLen - 1));
            if (!m) break;
            const end = minLen - 1 + m.index + 1;
            const chunk = this.buf.slice(0, end).trim();
            this.buf = this.buf.slice(end);
            if (chunk) {
                out.push(chunk);
                this.first = false;
            }
        }
        return out;
    }
    flush(): string | null {
        const rest = this.buf.trim();
        this.buf = "";
        return rest || null;
    }
}

// Voxtral rejects input that is empty after its own sanitization (e.g. emoji only).
const cleanForTts = (text: string) =>
    text.replace(/\p{Extended_Pictographic}|\uFE0F|\u200D/gu, "")
        .replace(/[*_`#>~]/g, "").replace(/\s+/g, " ").trim();

export const connectToMistral = async ({
    ws,
    payload,
    connectionPcmFile,
    firstMessage,
    systemPrompt,
    closeHandler,
}: ProviderArgs) => {
    const { user, supabase } = payload;
    const clientWs = ws as any;

    if (!mistralApiKey) {
        throw new Error("MISTRAL_API_KEY is not set");
    }

    const voiceId = user.personality?.oai_voice || DEFAULT_TTS_VOICE;
    const opus = createOpusPacketizer((packet) => ws.send(packet));
    const authHeaders = {
        Authorization: `Bearer ${mistralApiKey}`,
        "Content-Type": "application/json",
    };

    const history: Array<Record<string, unknown>> = [
        { role: "system", content: systemPrompt },
    ];
    const trimHistory = () => {
        if (history.length > MAX_HISTORY_MESSAGES + 1) {
            history.splice(1, history.length - MAX_HISTORY_MESSAGES - 1);
            // never start on an orphaned tool/assistant message
            while (history.length > 1 && history[1].role !== "user") history.splice(1, 1);
        }
    };

    let closed = false;
    let turnAbort: AbortController | null = null;
    let responding = false;
    let sessionEnding = false;

    // ---- STT: pre-warmed realtime sockets -------------------------------------
    type Stt = {
        sock: WebSocket;
        ready: Promise<void>;
        text: string;
        done: Promise<string>;
        finish: () => void;
        used: boolean;
        failed: boolean;
    };

    const openStt = (): Stt => {
        const sock = new WebSocket(`${STT_URL}?model=${STT_MODEL}`, {
            headers: { Authorization: `Bearer ${mistralApiKey}` },
        });
        let resolveDone!: (t: string) => void;
        const stt: Stt = {
            sock,
            text: "",
            used: false,
            failed: false,
            done: new Promise<string>((r) => (resolveDone = r)),
            finish: () => resolveDone(stt.text),
            ready: new Promise<void>((resolve, reject) => {
                sock.on("error", (e: any) => {
                    reject(e);
                    stt.finish();
                });
                sock.on("message", (data: RawData) => {
                    let ev: any;
                    try {
                        ev = JSON.parse(data.toString());
                    } catch {
                        return;
                    }
                    switch (ev.type) {
                        case "session.created":
                            sock.send(JSON.stringify({
                                type: "session.update",
                                session: {
                                    audio_format: { encoding: "pcm_s16le", sample_rate: STT_SAMPLE_RATE },
                                    target_streaming_delay_ms: STT_DELAY_MS,
                                },
                            }));
                            resolve();
                            break;
                        case "transcription.text.delta":
                            stt.text += ev.text ?? "";
                            break;
                        case "transcription.done":
                            if (typeof ev.text === "string" && ev.text.trim()) stt.text = ev.text;
                            stt.finish();
                            break;
                        case "error":
                            console.error("Mistral STT error:", ev);
                            stt.failed = true;
                            stt.finish();
                            break;
                    }
                });
                sock.on("close", () => {
                    reject(new Error("STT closed"));
                    stt.finish();
                });
            }),
        };
        stt.ready.catch(() => {});
        return stt;
    };

    let warmStt: Stt | null = openStt();
    const takeStt = (): Stt => {
        const s = warmStt && warmStt.sock.readyState <= WebSocket.OPEN ? warmStt : openStt();
        s.used = true;
        warmStt = null; // spare is opened after this one closes, keeping one live stream at a time
        return s;
    };

    // Warm the HTTPS connection to the LLM/TTS host so the first turn reuses it.
    fetch(`${MISTRAL_API}/models`, { headers: authHeaders }).then((r) => r.body?.cancel()).catch(() => {});

    // ---- device messages -------------------------------------------------------
    const send = (msg: string, extra: Record<string, unknown> = {}) => {
        if (ws.readyState === 1) ws.send(JSON.stringify({ type: "server", msg, ...extra }));
    };

    const interrupt = () => {
        turnAbort?.abort();
        turnAbort = null;
        opus.reset();
        if (responding) {
            responding = false;
            send("RESPONSE.INTERRUPTED");
        }
    };

    // ---- TTS ------------------------------------------------------------------
    // Eagerly starts the request; returns a queue of int16 PCM chunks at SAMPLE_RATE.
    const synthesize = (text: string, signal: AbortSignal): AsyncQueue<Buffer> => {
        const queue = new AsyncQueue<Buffer>();
        (async () => {
            try {
                const res = await fetch(`${MISTRAL_API}/audio/speech`, {
                    method: "POST",
                    headers: { ...authHeaders, Accept: "text/event-stream" },
                    signal,
                    body: JSON.stringify({
                        model: TTS_MODEL,
                        input: text,
                        ...(voiceId ? { voice_id: voiceId } : {}),
                        response_format: "pcm",
                        stream: true,
                    }),
                });
                if (!res.ok || !res.body) {
                    console.error("Mistral TTS failed:", res.status, await res.text().catch(() => ""));
                    return;
                }
                const toPcm16 = makeFloatToPcm16();
                const decoder = new TextDecoder();
                let pending = "";
                for await (const part of res.body as any) {
                    pending += decoder.decode(part, { stream: true });
                    let nl: number;
                    while ((nl = pending.indexOf("\n")) >= 0) {
                        const line = pending.slice(0, nl).trim();
                        pending = pending.slice(nl + 1);
                        if (!line.startsWith("data:")) continue;
                        try {
                            const ev = JSON.parse(line.slice(5));
                            if (ev.type === "speech.audio.delta" && ev.audio_data) {
                                const pcm = resample(
                                    toPcm16(Buffer.from(ev.audio_data, "base64")),
                                    TTS_SAMPLE_RATE,
                                    SAMPLE_RATE,
                                );
                                if (pcm.length) queue.push(pcm);
                            }
                        } catch { /* partial / keep-alive line */ }
                    }
                }
            } catch (err: any) {
                if (err?.name !== "AbortError") console.error("Mistral TTS error:", err);
            } finally {
                queue.end();
            }
        })();
        return queue;
    };

    // ---- LLM turn --------------------------------------------------------------
    const runTurn = async (userText: string, persistUser = true) => {
        interrupt();
        const abort = new AbortController();
        turnAbort = abort;
        const { signal } = abort;

        history.push({ role: "user", content: userText });
        trimHistory();
        if (persistUser) await addConversation(supabase, "user", userText, user).catch(() => {});

        responding = true;
        send("RESPONSE.CREATED", {
            volume_control: await getDeviceInfo(supabase, user.user_id).then((d) => d?.volume ?? 100).catch(() => 100),
        });

        // Chunks go to TTS as soon as they are cut; playback drains them in order.
        const playlist = new AsyncQueue<AsyncQueue<Buffer>>();
        const player = (async () => {
            let sentMs = 0;
            let startedAt = 0;
            for await (const audio of playlist) {
                for await (const pcm of audio) {
                    if (signal.aborted) return;
                    if (!startedAt) startedAt = Date.now();
                    const ahead = sentMs - (Date.now() - startedAt);
                    if (ahead > PLAYBACK_LEAD_MS) {
                        await new Promise((r) => setTimeout(r, ahead - PLAYBACK_LEAD_MS));
                        if (signal.aborted) return;
                    }
                    opus.push(pcm);
                    sentMs += pcm.length / BYTES_PER_MS;
                }
            }
        })();

        let reply = "";
        const toolCalls = new Map<number, { id: string; name: string; args: string }>();
        const speak = (text: string) => {
            const clean = cleanForTts(text);
            if (/[\p{L}\p{N}]/u.test(clean) && !signal.aborted) playlist.push(synthesize(clean, signal));
        };

        try {
            const res = await fetch(`${MISTRAL_API}/chat/completions`, {
                method: "POST",
                headers: { ...authHeaders, Accept: "text/event-stream" },
                signal,
                body: JSON.stringify({
                    model: LLM_MODEL,
                    messages: history,
                    tools: TOOLS,
                    stream: true,
                    temperature: TEMPERATURE,
                    max_tokens: MAX_TOKENS,
                }),
            });
            if (!res.ok || !res.body) {
                throw new Error(`Mistral chat failed: ${res.status} ${await res.text().catch(() => "")}`);
            }

            const chunker = new SentenceChunker();
            const decoder = new TextDecoder();
            let pending = "";
            for await (const part of res.body as any) {
                pending += decoder.decode(part, { stream: true });
                let nl: number;
                while ((nl = pending.indexOf("\n")) >= 0) {
                    const line = pending.slice(0, nl).trim();
                    pending = pending.slice(nl + 1);
                    if (!line.startsWith("data:") || line.includes("[DONE]")) continue;
                    let delta: any;
                    try {
                        delta = JSON.parse(line.slice(5)).choices?.[0]?.delta;
                    } catch {
                        continue;
                    }
                    if (!delta) continue;
                    const content = typeof delta.content === "string" ? delta.content : "";
                    if (content) {
                        reply += content;
                        chunker.push(content).forEach(speak);
                    }
                    for (const tc of delta.tool_calls ?? []) {
                        const cur = toolCalls.get(tc.index ?? 0) ?? { id: "", name: "", args: "" };
                        cur.id = tc.id ?? cur.id;
                        cur.name = tc.function?.name ?? cur.name;
                        cur.args += tc.function?.arguments ?? "";
                        toolCalls.set(tc.index ?? 0, cur);
                    }
                }
            }
            const rest = chunker.flush();
            if (rest) speak(rest);
        } catch (err: any) {
            if (err?.name !== "AbortError") {
                console.error("Mistral LLM error:", err);
                send("RESPONSE.ERROR");
            }
        } finally {
            playlist.end();
        }

        await player;
        if (signal.aborted) return; // barge-in already cleaned up

        if (reply.trim()) {
            history.push({ role: "assistant", content: reply });
            await addConversation(supabase, "assistant", reply, user).catch(() => {});
        }
        if ([...toolCalls.values()].some((t) => t.name === "end_session")) {
            sessionEnding = true;
        }
        opus.flush(true);
        responding = false;
        turnAbort = null;
        send("RESPONSE.COMPLETE");
        if (sessionEnding) send("SESSION.END");
    };

    // ---- turn detection + STT feeding -----------------------------------------
    let speaking = false;
    let speechMs = 0;
    let silenceMs = 0;
    let stt: Stt | null = null;
    const preroll: Buffer[] = [];
    let prerollBytes = 0;

    // Audio of the current utterance (16 kHz), kept so a failed STT stream can be replayed.
    let utterance: Buffer[] = [];

    const sendToStt = (target: Stt, pcm24: Buffer) => {
        const pcm16 = resample(pcm24, SAMPLE_RATE, STT_SAMPLE_RATE);
        utterance.push(pcm16);
        if (target.sock.readyState === WebSocket.OPEN) {
            target.sock.send(JSON.stringify({ type: "input_audio.append", audio: pcm16.toString("base64") }));
        }
    };

    const finishStt = async (target: Stt): Promise<string> => {
        if (target.sock.readyState === WebSocket.OPEN) {
            target.sock.send(JSON.stringify({ type: "input_audio.flush" }));
            target.sock.send(JSON.stringify({ type: "input_audio.end" }));
        }
        const text = await Promise.race([
            target.done,
            new Promise<string>((r) => setTimeout(() => r(target.text), 3000)),
        ]);
        target.sock.close();
        if (!closed && !warmStt) warmStt = openStt();
        return text.trim();
    };

    // Mistral's STT backend sometimes answers TooManyRequests; replay the audio on a fresh socket.
    const STT_RETRIES = 2;
    const retryStt = async (audio: Buffer[]): Promise<string> => {
        for (let attempt = 1; attempt <= STT_RETRIES; attempt++) {
            await new Promise((r) => setTimeout(r, 250 * attempt));
            warmStt?.sock.close(); // keep a single live stream while retrying
            warmStt = null;
            const fresh = openStt();
            try {
                await fresh.ready;
            } catch {
                continue;
            }
            for (const chunk of audio) {
                fresh.sock.send(JSON.stringify({ type: "input_audio.append", audio: chunk.toString("base64") }));
            }
            const text = await finishStt(fresh);
            if (text || !fresh.failed) return text;
        }
        return "";
    };

    const endOfSpeech = async () => {
        const current = stt;
        stt = null;
        speaking = false;
        speechMs = silenceMs = 0;
        if (!current) return;
        const audio = utterance;
        utterance = [];
        send("AUDIO.COMMITTED");
        let text = await finishStt(current);
        if (!text && current.failed && !closed) text = await retryStt(audio);
        if (closed) return;
        if (text) {
            await runTurn(text);
        } else {
            // Nothing transcribed: hand the device back to listening instead of leaving it in PROCESSING.
            send("RESPONSE.COMPLETE");
        }
    };

    let noiseFloor = 0;
    let lastLog = 0;
    const onMic = (pcm: Buffer) => {
        const frameMs = pcm.length / BYTES_PER_MS;
        const level = rms(pcm);
        const threshold = Math.max(VAD_MIN_LEVEL, noiseFloor * VAD_SNR);
        const loud = level > threshold;

        // Track the room's noise floor only from non-speech frames (fast down, slow up).
        if (!speaking && !loud) {
            noiseFloor = noiseFloor === 0 ? level : noiseFloor + (level - noiseFloor) * (level < noiseFloor ? 0.2 : 0.02);
        }
        if (VAD_DEBUG && Date.now() - lastLog > 500) {
            lastLog = Date.now();
            console.log(`VAD level=${level.toFixed(0)} floor=${noiseFloor.toFixed(0)} thr=${threshold.toFixed(0)} speaking=${speaking}`);
        }

        if (!speaking) {
            preroll.push(pcm);
            prerollBytes += pcm.length;
            while (prerollBytes > VAD_PREROLL_MS * BYTES_PER_MS && preroll.length > 1) {
                prerollBytes -= preroll.shift()!.length;
            }
            // leaky accumulator: brief dips between syllables don't reset it
            speechMs = loud ? speechMs + frameMs : Math.max(0, speechMs - frameMs / 2);
            if (speechMs >= VAD_MIN_SPEECH_MS) {
                speaking = true;
                silenceMs = 0;
                if (responding) interrupt();
                stt = takeStt();
                utterance = [];
                const target = stt;
                const backlog = Buffer.concat(preroll);
                preroll.length = 0;
                prerollBytes = 0;
                target.ready.then(() => sendToStt(target, backlog)).catch(() => {});
            }
            return;
        }

        const target = stt;
        if (target) target.ready.then(() => sendToStt(target, pcm)).catch(() => {});
        silenceMs = loud ? 0 : silenceMs + frameMs;
        if (silenceMs >= VAD_SILENCE_MS) endOfSpeech();
    };

    // ---- device socket -------------------------------------------------------
    clientWs.on("message", async (data: RawData, isBinary: boolean) => {
        if (isBinary) {
            const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer);
            if (isDev && connectionPcmFile) await connectionPcmFile.write(buffer);
            onMic(buffer);
            return;
        }
        let message: any;
        try {
            message = JSON.parse(Buffer.from(data as any).toString("utf-8"));
        } catch {
            return;
        }
        if (message?.type !== "instruction") return;
        if (message.msg === "INTERRUPT") interrupt();
        else if (message.msg === "END_SESSION") ws.close();
    });

    clientWs.on("error", (error: any) => console.error("ESP32 WebSocket error:", error));

    clientWs.on("close", async (code: number, reason: string) => {
        console.log(`ESP32 WebSocket closed with code ${code}, reason: ${reason}`);
        closed = true;
        turnAbort?.abort();
        stt?.sock.close();
        warmStt?.sock.close();
        await closeHandler();
        opus.close();
        if (isDev && connectionPcmFile) connectionPcmFile.close();
    });

    // Make sure the first STT socket is actually usable before we accept audio.
    await warmStt!.ready;

    // Spoken greeting: generated from the first-message prompt, not stored as a user turn.
    if (firstMessage.trim()) void runTurn(firstMessage, false);
};

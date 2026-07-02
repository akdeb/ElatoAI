/**
 * 60db.ai backend for the Cloudflare worker / Durable Object.
 *
 * Cloudflare deployments use Workers AI bindings for STT/LLM/TTS by default.
 * The cleanest way to slot 60db in without rebuilding the whole DO pipeline
 * is to expose a one-shot REST synthesizer that the existing TTS module can
 * delegate to when TTS_BACKEND=60db.
 *
 * If you also want 60db STT/LLM in Cloudflare, the full bidirectional
 * implementation lives in server/deno/models/sixtydb.ts and is straight-
 * forward to port (Cloudflare Workers do support outbound WebSockets via
 * the WebSocket API in Durable Objects).
 *
 * Docs: https://docs.60db.ai/api-reference/tts/text-to-speech
 */

import type { Env } from "../src/types";

const SYNTHESIZE_URL = "https://api.60db.ai/tts-synthesize";
const DEFAULT_VOICE_ID = "fbb75ed2-975a-40c7-9e06-38e30524a9a1"; // Zara

const AUDIO_SAMPLE_RATE = 24_000;

interface SynthesizeResponse {
    success?: boolean;
    message?: string;
    audio_base64?: string;
    sample_rate?: number;
    duration_seconds?: number;
    encoding?: string;
    output_format?: string;
}

function decodeBase64(b64: string): Uint8Array {
    // Cloudflare Workers expose atob, so we can decode via that path. For
    // small audio payloads this is plenty fast; for larger ones consider
    // streaming through Response(body) directly.
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
}

export async function synthesizeSpeechWith60db(
    env: Env,
    text: string,
): Promise<Response> {
    if (!env.SIXTYDB_API_KEY?.trim()) {
        throw new Error("SIXTYDB_API_KEY is missing");
    }

    const voiceId = env.SIXTYDB_VOICE_ID?.trim() || DEFAULT_VOICE_ID;

    const upstream = await fetch(SYNTHESIZE_URL, {
        method: "POST",
        headers: {
            "Authorization": `Bearer ${env.SIXTYDB_API_KEY}`,
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
        body: JSON.stringify({
            text,
            voice_id: voiceId,
            enhance: true,
            speed: 1.0,
            stability: 50,
            similarity: 75,
            // PCM16 mono — matches the format the DO's Opus packetizer expects.
            // Falls back to mp3 if 60db rejects (some accounts only ship mp3/wav).
            output_format: "wav",
        }),
    });

    if (!upstream.ok) {
        const text = await upstream.text().catch(() => "");
        throw new Error(`60db /tts-synthesize HTTP ${upstream.status}: ${text.slice(0, 200)}`);
    }

    const body = (await upstream.json()) as SynthesizeResponse;
    if (!body.audio_base64) {
        throw new Error(`60db returned no audio: ${body.message ?? "unknown"}`);
    }

    const audio = decodeBase64(body.audio_base64);

    // Hand BodyInit an ArrayBuffer (not a typed-array view) to dodge the
    // Uint8Array<ArrayBufferLike> generic incompatibility in TS 5.7+ libs.
    const arrayBuffer = audio.buffer.slice(
        audio.byteOffset,
        audio.byteOffset + audio.byteLength,
    ) as ArrayBuffer;

    return new Response(arrayBuffer, {
        headers: {
            "Content-Type": "audio/wav",
            "X-Sample-Rate": String(body.sample_rate ?? AUDIO_SAMPLE_RATE),
            "X-Encoding": body.encoding ?? "linear16",
        },
    });
}

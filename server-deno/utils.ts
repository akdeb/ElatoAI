import * as jose from "https://deno.land/x/jose@v5.9.6/index.ts";
import { getUserByEmail } from "./supabase.ts";
import { SupabaseClient } from "@supabase/supabase-js";
import crypto from "node:crypto";
import { Buffer } from "node:buffer";
import { Encoder } from "@evan/opus";

export const defaultVolume = 50;

// Define your audio parameters
export const SAMPLE_RATE = 24000; // For example, 24000 Hz
const CHANNELS = 1; // Mono (set to 2 if you have stereo)
const FRAME_DURATION = 120; // Frame length in ms
const BYTES_PER_SAMPLE = 2; // 16-bit PCM: 2 bytes per sample
const FRAME_SIZE = (SAMPLE_RATE * FRAME_DURATION / 1000) * CHANNELS *
    BYTES_PER_SAMPLE; // 960 bytes for 24000 Hz mono 16-bit

const encoder = new Encoder({
    channels: CHANNELS,
    sample_rate: SAMPLE_RATE,
    application: "voip",
});

encoder.expert_frame_duration = FRAME_DURATION;
encoder.bitrate = 12000;

export const openaiApiKey = Deno.env.get("OPENAI_API_KEY");
export const geminiApiKey = Deno.env.get("GEMINI_API_KEY");
export const elevenLabsApiKey = Deno.env.get("ELEVENLABS_API_KEY");
export const humeApiKey = Deno.env.get('HUME_API_KEY');

export { encoder, FRAME_SIZE };

export const isDev = Deno.env.get("DEV_MODE") === "True";

export const authenticateUser = async (
    supabaseClient: SupabaseClient,
    authToken: string,
): Promise<IUser> => {
    try {
        const jwtSecret = Deno.env.get("JWT_SECRET_KEY");

        if (!jwtSecret) throw new Error("JWT_SECRET_KEY not configured");

        const secretBytes = new TextEncoder().encode(jwtSecret);
        const payload = await jose.jwtVerify(authToken, secretBytes);

        const { payload: { email } } = payload;
        const user = await getUserByEmail(supabaseClient, email as string);
        return user;
    } catch (error: any) {
        throw new Error(error.message || "Failed to authenticate user");
    }
};

/**
 * Decrypts an encrypted secret with the same master encryption key.
 * @param encryptedData - base64 string from the database
 * @param iv - base64 IV from the database
 * @param masterKey - 32-byte string or buffer
 * @returns the original plaintext secret
 */
export function decryptSecret(
    encryptedData: string,
    iv: string,
    masterKey: string,
) {
    // Decode the base64 master key
    const decodedKey = Buffer.from(masterKey, "base64");
    if (decodedKey.length !== 32) {
        throw new Error(
            "ENCRYPTION_KEY must be 32 bytes when decoded from base64.",
        );
    }

    const decipher = crypto.createDecipheriv(
        "aes-256-cbc",
        decodedKey, // Use the decoded key instead of raw masterKey
        Buffer.from(iv, "base64"),
    );

    let decrypted = decipher.update(encryptedData, "base64", "utf8");
    decrypted += decipher.final("utf8");
    return decrypted;
}


export function boostLimitPCM16LEInPlace(
    pcmBytes: Uint8Array,      // Buffer is fine (subclass of Uint8Array)
    gainDb = 6.0,
    ceiling = 0.89,            // ≈ −1 dBFS
): void {
    const dv = new DataView(pcmBytes.buffer, pcmBytes.byteOffset, pcmBytes.byteLength);
    const g = Math.pow(10, gainDb / 20);

    // Pass 1: measure post-gain peak
    let peak = 0;
    for (let i = 0; i < dv.byteLength; i += 2) {
        const s = dv.getInt16(i, true) / 32768; // 16-bit LE → [-1,1]
        const y = s * g;
        const a = Math.abs(y);
        if (a > peak) peak = a;
    }
    const scale = peak > ceiling && peak > 0 ? (ceiling / peak) : 1;

    // Pass 2: apply gain + scale + gentle soft-clip
    for (let i = 0; i < dv.byteLength; i += 2) {
        let y = (dv.getInt16(i, true) / 32768) * g * scale;
        // cubic soft-clip (tanh-ish) for nicer peaks
        const y2 = y * y;
        y = 0.5 * y * (3 - y2);
        if (y > 0.999) y = 0.999;
        if (y < -0.999) y = -0.999;
        dv.setInt16(i, (y * 32767) | 0, true);
    }
}


// Function to downsample PCM audio from 48kHz to 24kHz
export function downsamplePcm(pcmBuffer: Buffer, fromRate: number, toRate: number): Buffer {
    if (fromRate === toRate) {
        return pcmBuffer;
    }

    const ratio = fromRate / toRate;
    const inputSamples = pcmBuffer.length / 2; // 16-bit = 2 bytes per sample
    const outputSamples = Math.floor(inputSamples / ratio);
    const outputBuffer = Buffer.alloc(outputSamples * 2);

    for (let i = 0; i < outputSamples; i++) {
        const sourceIndex = Math.floor(i * ratio) * 2;
        const sample = pcmBuffer.readInt16LE(sourceIndex);
        outputBuffer.writeInt16LE(sample, i * 2);
    }

    return outputBuffer;
}


// Function to extract PCM data from WAV file
export function extractPcmFromWav(wavBuffer: Buffer): Buffer | null {
    try {
        // Check minimum WAV header size
        if (wavBuffer.length < 44) {
            console.error('WAV file too small');
            return null;
        }

        // Verify RIFF header
        const riffHeader = wavBuffer.subarray(0, 4).toString('ascii');
        if (riffHeader !== 'RIFF') {
            console.error('Not a RIFF file');
            return null;
        }

        // Verify WAVE format
        const waveHeader = wavBuffer.subarray(8, 12).toString('ascii');
        if (waveHeader !== 'WAVE') {
            console.error('Not a WAVE file');
            return null;
        }

        // Find the data chunk
        let offset = 12;
        while (offset < wavBuffer.length - 8) {
            const chunkId = wavBuffer.subarray(offset, offset + 4).toString('ascii');
            const chunkSize = wavBuffer.readUInt32LE(offset + 4);

            if (chunkId === 'data') {
                // Found data chunk, extract PCM data
                const pcmData = wavBuffer.subarray(offset + 8, offset + 8 + chunkSize);
                return pcmData;
            }

            // Move to next chunk
            offset += 8 + chunkSize;
        }

        console.error('No data chunk found in WAV file');
        return null;
    } catch (error) {
        console.error('Error extracting PCM from WAV:', error);
        return null;
    }
}
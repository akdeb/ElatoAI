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

// Azure OpenAI Configuration
export const azureOpenAIEndpoint = Deno.env.get("AZURE_OPENAI_ENDPOINT");
export const azureOpenAIApiKey = Deno.env.get("AZURE_OPENAI_API_KEY");
export const azureOpenAIDeployment = Deno.env.get("AZURE_OPENAI_DEPLOYMENT_NAME");

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

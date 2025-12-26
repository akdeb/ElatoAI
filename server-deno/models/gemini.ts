import { Buffer } from "node:buffer";
import type { WebSocketServer as _WebSocketServer } from "npm:@types/ws";
import {
    EndSensitivity,
    GoogleGenAI,
    LiveConnectConfig,
    LiveServerMessage,
    Modality,
    Session,
} from "npm:@google/genai";
import { createOpusPacketizer, geminiApiKey, isDev, defaultGeminiVoice } from "../utils.ts";
import { addConversation } from "../supabase.ts";

export const connectToGemini = async ({
    ws,
    payload,
    connectionPcmFile,
    firstMessage,
    systemPrompt,
    closeHandler,
}: ProviderArgs) => {
    const { user, supabase } = payload;
    const voiceName = user.personality?.oai_voice ?? defaultGeminiVoice;

    const opus = createOpusPacketizer((packet) => ws.send(packet));

    console.log(`Connecting with Gemini key "${geminiApiKey?.slice(0, 3)}..."`);

    // Initialize Google GenAI
    const ai = new GoogleGenAI({ apiKey: geminiApiKey });
    const model = "gemini-2.5-flash-native-audio-preview-09-2025";
    const config: LiveConnectConfig = {
        responseModalities: [Modality.AUDIO],
        systemInstruction: systemPrompt,
        speechConfig: {
            voiceConfig: {
                prebuiltVoiceConfig: {
                    voiceName: voiceName,
                },
            },
        },
        realtimeInputConfig: {
            automaticActivityDetection: {
                disabled: false, // Keep VAD enabled
                endOfSpeechSensitivity: EndSensitivity.END_SENSITIVITY_LOW,
                silenceDurationMs: 100,
            },
        },
        outputAudioTranscription: {},
        inputAudioTranscription: {},
    };

    // Response queue for handling Google's callback-based responses
    const responseQueue: LiveServerMessage[] = [];
    let geminiSession: Session | null = null;

    async function waitMessage() {
        let done = false;
        let message: LiveServerMessage | undefined = undefined;
        while (!done) {
            message = responseQueue.shift();
            if (message) {
                done = true;
            } else {
                await new Promise((resolve) => setTimeout(resolve, 10));
            }
        }
        return message;
    }

    async function handleTurn() {
        const turns: any[] = [];
        let done = false;
        while (!done) {
            const message = await waitMessage();
            turns.push(message);

            if (message.serverContent) {
                if (message.serverContent.generationComplete) {
                    opus.reset();
                    ws.send(JSON.stringify({
                        type: "server",
                        msg: "RESPONSE.CREATED",
                    }));
                    done = true;
                }
            }
        }
        return turns;
    }

    async function processGeminiTurns() {
        try {
            console.log("Processing Gemini turns");
            while (geminiSession) {
                const turns = await handleTurn();

                // Combine all audio data from this turn
                const combinedAudio = turns.reduce(
                    (acc: number[], turn: any) => {
                        if (turn.data) {
                            const buffer = Buffer.from(turn.data, "base64");
                            const intArray = new Int16Array(
                                buffer.buffer,
                                buffer.byteOffset,
                                buffer.byteLength /
                                    Int16Array.BYTES_PER_ELEMENT,
                            );
                            return acc.concat(Array.from(intArray));
                        }
                        return acc;
                    },
                    [],
                );

                if (combinedAudio.length > 0) {
                    // Convert back to buffer and send to client
                    const audioBuffer = new Int16Array(combinedAudio);
                    const buffer = Buffer.from(audioBuffer.buffer);

                    // Use Opus packetizer to encode and send audio
                    opus.push(buffer);
                    opus.flush(true);
                }

                // Handle text responses if any
                let outputTranscriptionText = "";
                let inputTranscriptionText = "";
                for (const turn of turns as LiveServerMessage[]) {
                    if (
                        turn.serverContent &&
                        turn.serverContent.outputTranscription
                    ) {
                        outputTranscriptionText +=
                            turn.serverContent.outputTranscription.text;
                    }

                    if (
                        turn.serverContent &&
                        turn.serverContent.inputTranscription
                    ) {
                        inputTranscriptionText +=
                            turn.serverContent.inputTranscription.text;
                    }
                }

                // Send completion signal
                ws.send(JSON.stringify({
                    type: "server",
                    msg: "RESPONSE.COMPLETE",
                }));

                // Add user transcription to supabase
                await addConversation(
                    supabase,
                    "user",
                    inputTranscriptionText,
                    user,
                );

                // Add assistant transcription to supabase
                await addConversation(
                    supabase,
                    "assistant",
                    outputTranscriptionText,
                    user,
                );
            }
        } catch (error) {
            console.error("Error processing Gemini turns:", error);
        }
    }

    // Connect to Google Gemini Live
    try {
        geminiSession = await ai.live.connect({
            model: model,
            callbacks: {
                onopen: function () {
                    console.log("Gemini session opened");
                },
                onmessage: function (message: LiveServerMessage) {
                    responseQueue.push(message);
                },
                onerror: function (e: any) {
                    console.error("Gemini error:", e.message);
                    ws.send(
                        JSON.stringify({
                            type: "server",
                            msg: "RESPONSE.ERROR",
                        }),
                    );
                },
                onclose: function (e: any) {
                    console.log("Gemini session closed:", e.reason);
                },
            },
            config: config,
        });

        console.log("Connected to Gemini successfully!");
        // Send first message if available
        const inputTurns = [{
            role: "user",
            parts: [{ text: firstMessage }],
        }];
        geminiSession?.sendClientContent({ turns: inputTurns });
        processGeminiTurns();
    } catch (e: unknown) {
        console.log(`Error connecting to Gemini: ${e}`);
        ws.close();
        return;
    }

    ws.on("message", (data: any, isBinary: boolean) => {
        try {
            if (isBinary) {
                // Handle binary audio data from ESP32
                const base64Data = data.toString("base64");

                if (isDev && connectionPcmFile) {
                    connectionPcmFile.write(data);
                }

                // Send audio to Gemini
                geminiSession?.sendRealtimeInput({
                    audio: {
                        data: base64Data,
                        mimeType: "audio/pcm;rate=24000",
                    },
                });
            }
        } catch (e: unknown) {
            console.error("Error handling message:", (e as Error).message);
        }
    });

    ws.on("error", (error: any) => {
        console.error("WebSocket error:", error);
        geminiSession?.close();
    });

    ws.on("close", async (code: number, reason: string) => {
        console.log(`WebSocket closed with code ${code}, reason: ${reason}`);
        await closeHandler();
        opus.close();
        geminiSession?.close();
        if (isDev && connectionPcmFile) {
            connectionPcmFile.close();
            console.log("Closed debug audio file.");
        }
    });
};

import { Buffer } from "node:buffer";
import type { RawData } from "npm:@types/ws";
// @ts-ignore
import {
    WebSocketConnection,
    type SessionConfig,
    type IncomingSocketEvent,
    type DisconnectionDetails
} from "npm:@elevenlabs/client";

import { addConversation, getDeviceInfo } from "../supabase.ts";
import { createOpusPacketizer, isDev } from "../utils.ts";

// Calculate audio level for debugging
function calculateAudioLevel(audioData: any): number {
    if (!audioData || audioData.length === 0) return 0;
    
    // Convert to 16-bit samples
    const samples = new Int16Array(audioData.buffer || audioData);
    let sum = 0;
    
    for (let i = 0; i < samples.length; i++) {
        sum += Math.abs(samples[i]);
    }
    
    return Math.round(sum / samples.length);
}

export const connectToElevenLabs = async (
    ws: WebSocket,
    payload: IPayload,
    connectionPcmFile: Deno.FsFile | null,
    agentId: string,
    apiKey: string,
    closeHandler: () => Promise<void>,
) => {
    console.log(apiKey, agentId);
    const { user, supabase } = payload;

    const opus = createOpusPacketizer((packet) => ws.send(packet));

    // Queue messages until ElevenLabs connection is ready
    const messageQueue: RawData[] = [];
    let isElevenLabsConnected = false;
    let elevenLabsConnection: WebSocketConnection | null = null;
    let hasResponseStarted = false;

    // Handle messages from ESP32 client
    const handleClientMessage = async (data: any, isBinary: boolean) => {
        try {
            if (isBinary) {
                const base64Data = data.toString("base64");

                if (isDev && connectionPcmFile) {
                    await connectionPcmFile.write(data);
                }

                // Send audio to ElevenLabs using their client
                if (isElevenLabsConnected && elevenLabsConnection) {
                    // Check if audio contains actual speech (simple volume check)
                    const audioLevel = calculateAudioLevel(data);
                    console.log(`Sending audio chunk to ElevenLabs: raw=${data.length} bytes, base64=${base64Data.length} chars, level=${audioLevel}`);
                    
                    try {
                        elevenLabsConnection.sendMessage({
                            user_audio_chunk: base64Data,
                        });
                    } catch (error) {
                        console.error("Error sending audio to ElevenLabs:", error);
                    }
                } else {
                    console.log(`Cannot send audio - ElevenLabs connected: ${isElevenLabsConnected}, connection exists: ${!!elevenLabsConnection}`);
                }
            } else {
                const message = JSON.parse(data.toString("utf-8"));

                if (message.type === "instruction") {
                    switch (message.msg) {
                        case "INTERRUPT":
                            console.log("Interrupt detected");
                            if (elevenLabsConnection) {
                                elevenLabsConnection.sendMessage({
                                    type: "user_activity"
                                });
                            }
                            break;

                        case "END_SESSION":
                            console.log("End session requested");
                            if (elevenLabsConnection) {
                                elevenLabsConnection.close();
                            }
                            break;
                    }
                }
            }
        } catch (error) {
            console.error("Error handling client message:", error);
        }
    };

    try {
        // For server-side usage, we need to get a signed URL first
        const signedUrlResponse = await fetch(
            `https://api.elevenlabs.io/v1/convai/conversation/get-signed-url?agent_id=${agentId}`,
            {
                headers: {
                    'xi-api-key': apiKey,
                },
            }
        );

        if (!signedUrlResponse.ok) {
            throw new Error(`Failed to get signed URL: ${signedUrlResponse.status} ${signedUrlResponse.statusText}`);
        }

        const { signed_url } = await signedUrlResponse.json();

        // Use default audio formats (let ElevenLabs auto-detect)
        const modifiedSignedUrl = signed_url;

        // Create ElevenLabs connection using signed URL for server-side usage
        const sessionConfig: SessionConfig = {
            signedUrl: modifiedSignedUrl,
            connectionType: "websocket",
        };

        elevenLabsConnection = await WebSocketConnection.create(sessionConfig);

        console.log("Connected to ElevenLabs successfully!");
        isElevenLabsConnected = true;
        console.log(`ElevenLabs connection ready - conversation_initiation_metadata already processed by SDK`);

        // Set up ElevenLabs event handlers
        elevenLabsConnection.onMessage(async (event: IncomingSocketEvent) => {
            console.log("ElevenLabs message type:", event);

            switch (event.type) {
                case "conversation_initiation_metadata":
                    console.log("ElevenLabs conversation initiated (metadata received)");
                    break;

                case "ping":
                    // Handle ping messages - send pong response
                    console.log("Received ping from ElevenLabs, sending pong");
                    if (event.ping_event?.event_id) {
                        elevenLabsConnection.sendMessage({
                            type: "pong",
                            event_id: event.ping_event.event_id
                        });
                    }
                    break;

                case "audio":
                    if (event.audio_event?.audio_base_64) {
                        // Send RESPONSE.CREATED before first audio chunk
                        if (!hasResponseStarted) {
                            console.log("Sending RESPONSE.CREATED to ESP32 (agent audio starting)");
                            opus.reset();
                            ws.send(JSON.stringify({
                                type: "server",
                                msg: "RESPONSE.CREATED"
                            }));
                            hasResponseStarted = true;
                        }

                        const audioBuffer = Buffer.from(event.audio_event.audio_base_64, "base64");
                        console.log(`Received audio from ElevenLabs: ${audioBuffer.length} bytes`);

                        // Use Opus packetizer to encode and send audio
                        opus.push(audioBuffer);
                    }
                    break;

                case "user_transcript":
                    if (event.user_transcription_event?.user_transcript) {
                        console.log("User transcript:", event.user_transcription_event.user_transcript);
                        addConversation(
                            supabase,
                            "user",
                            event.user_transcription_event.user_transcript,
                            user,
                        );

                        if (!hasResponseStarted) {
                            console.log("Sending RESPONSE.CREATED to ESP32 (agent audio starting)");
                            opus.reset();
                            ws.send(JSON.stringify({
                                type: "server",
                                msg: "RESPONSE.CREATED"
                            }));
                            hasResponseStarted = true;
                        }
                    }
                    break;

                case "agent_response":
                    if (event.agent_response_event?.agent_response) {
                        console.log("Agent response:", event.agent_response_event.agent_response);
                        addConversation(
                            supabase,
                            "assistant",
                            event.agent_response_event.agent_response,
                            user,
                        );

                        // Flush any remaining audio before sending complete
                        opus.flush(true);

                        // Send response complete with device info like OpenAI does
                        console.log("Sending RESPONSE.COMPLETE to ESP32");
                        hasResponseStarted = false; // Reset for next response
                        try {
                            const device = await getDeviceInfo(supabase, user.user_id);
                            ws.send(JSON.stringify({
                                type: "server",
                                msg: "RESPONSE.COMPLETE",
                                volume_control: device?.volume ?? 100,
                            }));
                        } catch (error) {
                            console.error("Error fetching updated device info:", error);
                            ws.send(JSON.stringify({
                                type: "server",
                                msg: "RESPONSE.COMPLETE",
                            }));
                        }
                    }
                    break;

                case "vad_score":
                    // Voice Activity Detection score - can be used for debugging
                    if (event.vad_score_event?.vad_score) {
                        console.log("VAD score:", event.vad_score_event.vad_score);
                    }
                    break;

                case "internal_tentative_agent_response":
                    // Tentative response while agent is thinking
                    if (event.tentative_agent_response_internal_event?.tentative_agent_response) {
                        console.log("Tentative response:", event.tentative_agent_response_internal_event.tentative_agent_response);
                    }
                    break;

                case "conversation_end":
                    console.log("ElevenLabs conversation ended");
                    ws.send(JSON.stringify({
                        type: "server",
                        msg: "SESSION.END"
                    }));
                    break;

                default:
                    console.log("Unknown ElevenLabs message:", event.type, event);
            }
        });

        elevenLabsConnection.onDisconnect((details: DisconnectionDetails) => {
            console.log("ElevenLabs connection closed:", details.reason);
            ws.close();
        });

        // Process queued messages
        while (messageQueue.length > 0) {
            const queuedMessage = messageQueue.shift();
            if (queuedMessage) {
                handleClientMessage(queuedMessage, false);
            }
        }

        // Set up ESP32 WebSocket handlers
        ws.on("message", (data: any, isBinary: boolean) => {
            if (!isElevenLabsConnected) {
                messageQueue.push(data);
            } else {
                handleClientMessage(data, isBinary);
            }
        });

        ws.on("error", (error: any) => {
            console.error("ESP32 WebSocket error:", error);
            elevenLabsConnection?.close();
        });

        ws.on("close", async (code: number, reason: string) => {
            console.log(`ESP32 WebSocket closed with code ${code}, reason: ${reason}`);
            await closeHandler();
            opus.close();
            elevenLabsConnection?.close();

            if (isDev && connectionPcmFile) {
                connectionPcmFile.close();
                console.log("Closed debug audio file.");
            }
        });
    } catch (error) {
        console.error("Failed to connect to ElevenLabs:", error);

        // Send more specific error information
        let errorMessage = "RESPONSE.ERROR";
        if (error instanceof Error) {
            console.error("Error details:", error.message);
            if (error.message.includes("signed URL")) {
                errorMessage = "AUTH.ERROR";
            }
        }

        ws.send(JSON.stringify({
            type: "server",
            msg: errorMessage
        }));
    }
};

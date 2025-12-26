import { Buffer } from "node:buffer";
import type { RawData } from "npm:@types/ws";
import { RealtimeClient } from "../realtime/client.js";
import { RealtimeUtils } from "../realtime/utils.js";
import { addConversation, getDeviceInfo } from "../supabase.ts";
import { createOpusPacketizer, isDev, openaiApiKey, defaultOpenAIVoice } from "../utils.ts";

const sendFirstMessage = (client: RealtimeClient, firstMessage: string) => {
    const event = {
        event_id: RealtimeUtils.generateId("evt_"), // Generate unique ID
        type: "conversation.item.create",
        previous_item_id: "root",
        item: {
            type: "message",
            role: "system",
            content: [{
                type: "input_text",
                text: firstMessage,
            }],
        },
    };

    client.realtime.send(event.type, event);
    client.realtime.send("response.create", {
        event_id: RealtimeUtils.generateId("evt_"), // Generate unique ID
        type: "response.create",
    });
};

export const connectToOpenAI = async ({
    ws,
    payload,
    connectionPcmFile,
    firstMessage,
    systemPrompt,
    closeHandler,
}: ProviderArgs) => {
    const { user, supabase } = payload;

    const opus = createOpusPacketizer((packet) => ws.send(packet));

    let currentItemId: string | null = null;
    let currentCallId: string | null = null;

    // Instantiate new client
    console.log(`Connecting with key "${openaiApiKey?.slice(0, 3)}..."`);
    const client = new RealtimeClient({ apiKey: openaiApiKey });

    // ADD TOOL CALLS HERE
    client.addTool(
        {
            type: "function",
            name: "end_session",
            description:
                'Call this if the user says bye or needs to leave or suggests they want to end the session. (e.g. "I gotta to go", "I have to work", "I have to sleep", "I have to do something else")',
            parameters: {
                type: "object",
                strict: true,
                properties: {
                    reason: {
                        type: "string",
                        description: "Short reason for ending the session.",
                    },
                },
                required: ["reason"],
            },
        },
        (args: any) => {
            console.log("end session", args);

            // Send your custom message to the client
            ws.send(JSON.stringify({ type: "server", msg: "SESSION.END" }));

            // Return the result for the callback
            return { success: true, message: `Session ended: ${args.reason}` };
        },
    );

    // Relay: OpenAI Realtime API Event -> Browser Event
    client.realtime.on("server.*", async (event: any) => {
        // Check if the event is session.created
        if (event.type === "session.created") {
            console.log("session created", event);
            sendFirstMessage(client, firstMessage);
        } else if (event.type === "session.updated") {
            console.log("session updated", event);
        } else if (event.type === "error") {
            console.log("error", event);
        } else if (event.type === "response.done") {
            console.log("response.done", event);
            const hasNoAudio = event.response?.usage?.output_token_details?.audio_tokens === 0;
            opus.flush(true);
            if (!hasNoAudio) {
                ws.send(
                    JSON.stringify({
                        type: "server",
                        msg: "RESPONSE.COMPLETE",
                    }),
                );
            }
        } else if (event.type === "response.audio_transcript.done") {
            console.log("response.audio_transcript.done", event);
            await addConversation(
                supabase,
                "assistant",
                event.transcript,
                user,
            );
        } else if (event.type === "input_audio_buffer.committed") {
            ws.send(JSON.stringify({ type: "server", msg: "AUDIO.COMMITTED" }));
        }

        if (event.type in client.conversation.EventProcessors) {
            try {
                switch (event.type) {
                    case "response.created":
                        console.log("response.created", event);
                        opus.reset();
                        try {
                            const device = await getDeviceInfo(supabase, user.user_id);

                            if (device) {
                                // Send the updated volume data along with the response complete message
                                ws.send(JSON.stringify({
                                    type: "server",
                                    msg: "RESPONSE.CREATED",
                                    volume_control: device.volume ?? 100,
                                }));
                            } else {
                                // Fall back to just sending the complete message if there's an error
                                ws.send(
                                    JSON.stringify({
                                        type: "server",
                                        msg: "RESPONSE.CREATED",
                                    }),
                                );
                            }
                        } catch (error) {
                            console.error("Error fetching updated device info:", error);
                            ws.send(
                                JSON.stringify({
                                    type: "server",
                                    msg: "RESPONSE.CREATED",
                                }),
                            );
                        }
                        break;
                    case "response.output_item.added":
                        console.log("response.output_item.added", event);
                        if (event.item.id) {
                            console.log("foobar", event.item.id);
                            currentItemId = event.item.id;
                            currentCallId = event.item.call_id;
                        }
                        break;
                    case "response.audio.delta":
                        {
                            const { delta } = client.conversation.processEvent(
                                event,
                            );
                            try {
                                if (delta?.audio?.buffer) {
                                    const pcmBuffer = Buffer.from(
                                        delta.audio.buffer,
                                    );
                                    opus.push(pcmBuffer);
                                }
                            } catch (audioError) {
                                console.error(
                                    "Error processing audio delta:",
                                    audioError,
                                );
                                // Don't send any audio data if there's an error at this level
                            }
                        }
                        break;
                    case "conversation.item.created":
                        console.log("user said: ", event.item);
                        break;
                    case "conversation.item.input_audio_transcription.completed":
                        console.log("user transcription:", event);
                        await addConversation(
                            supabase,
                            "user",
                            event.transcript,
                            user,
                        );
                        break;
                }
            } catch (error) {
                console.error("Error processing event:", error);
                console.error("Event that caused the error:", event);
                ws.send(
                    JSON.stringify({ type: "server", msg: "RESPONSE.ERROR" }),
                );
            }
        }
    });

    client.realtime.on("close", () => ws.close());

    // Relay: Browser Event -> OpenAI Realtime API Event
    // We need to queue data waiting for the OpenAI connection
    const messageQueue: RawData[] = [];

    const messageHandler = async (data: any, isBinary: boolean) => {
        try {
            let event;

            // for esp32
            if (isBinary) {
                const base64Data = data.toString("base64");

                // Convert binary PCM16 data to base64 for OpenAI Realtime API
                event = {
                    event_id: RealtimeUtils.generateId("evt_"), // Generate unique ID
                    type: "input_audio_buffer.append",
                    audio: base64Data,
                };
                // Write the raw PCM data to file for debugging if enabled.
                // Also write the base64 data to a separate file
                if (isDev) {
                    if (connectionPcmFile) {
                        await connectionPcmFile.write(data);
                    }
                }
                client.realtime.send(event.type, event);
            } else { // Manual VAD
                const message = JSON.parse(data.toString("utf-8"));

                // commit user audio and create response
                if (
                    message.type === "instruction" &&
                    message.msg === "end_of_speech"
                ) {
                    console.log("end_of_speech detected");

                    client.realtime.send("input_audio_buffer.commit", {
                        event_id: RealtimeUtils.generateId("evt_"), // Generate unique ID
                        type: "input_audio_buffer.commit",
                    });

                    client.realtime.send("response.create", {
                        event_id: RealtimeUtils.generateId("evt_"), // Generate unique ID
                        type: "response.create",
                    });

                    client.realtime.send("input_audio_buffer.clear", {
                        event_id: RealtimeUtils.generateId("evt_"), // Generate unique ID
                        type: "input_audio_buffer.clear",
                    });
                } else if (
                    message.type === "instruction" &&
                    message.msg === "INTERRUPT"
                ) {
                    console.log("interrupt detected", message);
                    const audioEndMs = message.audio_end_ms;

                    client.realtime.send("conversation.item.truncate", {
                        event_id: RealtimeUtils.generateId("evt_"), // Generate unique ID
                        type: "conversation.item.truncate",
                        item_id: currentItemId,
                        content_index: 0,
                        audio_end_ms: audioEndMs,
                    });

                    client.realtime.send("input_audio_buffer.clear", {
                        event_id: RealtimeUtils.generateId("evt_"), // Generate unique ID
                        type: "input_audio_buffer.clear",
                    });
                }
            }
        } catch (e: unknown) {
            console.error((e as Error).message);
            console.log(`Error parsing event from client: ${data}`);
        }
    };

    ws.on("message", (data: any, isBinary: boolean) => {
        if (!client.isConnected()) {
            messageQueue.push(data);
        } else {
            messageHandler(data, isBinary);
        }
    });

    // Add error handler
    ws.on("error", (error: any) => {
        console.error("WebSocket error:", error);
        client.disconnect();
    });

    // Add more detailed close handling
    ws.on("close", async (code: number, reason: string) => {
        console.log(`WebSocket closed with code ${code}, reason: ${reason}`);
        await closeHandler();
        opus.close();
        client.disconnect();
        if (isDev) {
            if (connectionPcmFile) {
                connectionPcmFile.close();
                console.log(`Closed debug audio file.`);
            }
        }
    });

    // Connect to the OpenAI Realtime API
    try {
        console.log(`Connecting to OpenAI...`);
        const sessionOptions = {
            model: "gpt-4o-mini-realtime-preview-2024-12-17",
            turn_detection: {
                type: "server_vad",
                threshold: 0.4,
                prefix_padding_ms: 400,
                silence_duration_ms: 1000,
            },
            voice: user.personality?.oai_voice ?? defaultOpenAIVoice,
            instructions: systemPrompt,
            input_audio_transcription: { model: "whisper-1" },
        };
        await client.connect(sessionOptions as any);
    } catch (e: unknown) {
        console.log(`Error connecting to OpenAI: ${e as Error}`);
        ws.close();
        return;
    }
    console.log(`Connected to OpenAI successfully!`);
    while (messageQueue.length) {
        messageHandler(messageQueue.shift(), false);
    }
};

import { Buffer } from "node:buffer";
import { createServer } from "node:http";
import { WebSocketServer } from "npm:ws";
import type {
    RawData,
    WebSocket as WSWebSocket,
    WebSocketServer as _WebSocketServer,
} from "npm:@types/ws";

import { RealtimeClient } from "./realtime/client.js";
import { RealtimeUtils } from "./realtime/utils.js";
import { authenticateUser } from "./utils.ts";
import {
    addConversation,
    createFirstMessage,
    createSystemPrompt,
    getChatHistory,
    getDeviceInfo,
    getSupabaseClient,
    updateUserSessionTime,
} from "./supabase.ts";
import { SupabaseClient } from "@supabase/supabase-js";

// import { Opus, OpusApplication } from 'https://deno.land/x/opus@0.1.1/opus.ts';

// await Opus.load(); // Make sure the Opus module is loaded

// // Define your audio parameters (adjust as needed)
// const SAMPLE_RATE = 24000; // e.g., 48000 Hz
// const CHANNELS = 1; // Stereo (change to 1 if using mono)
// const FRAME_DURATION = 20; // Frame length in ms

// // Calculate the number of samples per frame
// const frameSize = (SAMPLE_RATE * FRAME_DURATION) / 1000;

// // Create a global encoder instance (reuse this for every audio delta)
// const encoder = new Opus(SAMPLE_RATE, CHANNELS, OpusApplication.AUDIO);

import { Encoder } from "@evan/opus";

const isDev = Deno.env.get("DEV_MODE") === "True";

// Define your audio parameters
const SAMPLE_RATE = 24000; // For example, 24000 Hz
const CHANNELS = 1; // Mono (set to 2 if you have stereo)
const FRAME_DURATION = 120; // Frame length in ms

const BYTES_PER_SAMPLE = 2; // 16-bit PCM: 2 bytes per sample
// Calculate the number of bytes per frame:
// samples = SAMPLE_RATE * FRAME_DURATION / 1000
// bytes = samples * CHANNELS * BYTES_PER_SAMPLE
const FRAME_SIZE = (SAMPLE_RATE * FRAME_DURATION / 1000) * CHANNELS *
    BYTES_PER_SAMPLE; // 960 bytes for 24000 Hz mono 16-bit

// Evan's library doesn’t require you to specify frame size here;
// it will automatically handle the frame size based on your PCM input.
// Create a global encoder instance (reuse this for every audio delta)
const encoder = new Encoder({
    channels: CHANNELS,
    sample_rate: SAMPLE_RATE,
    application: "voip",
});

encoder.expert_frame_duration = FRAME_DURATION;
encoder.bitrate = 12000;

const server = createServer();

const wss: _WebSocketServer = new WebSocketServer({ noServer: true });

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

const supabaseUrl = Deno.env.get("SUPABASE_URL");
const supabaseKey = Deno.env.get("SUPABASE_KEY");
const openaiApiKey = Deno.env.get("OPENAI_API_KEY");

if (!supabaseUrl || !supabaseKey) {
    throw new Error("SUPABASE_URL or SUPABASE_KEY is not set");
}

wss.on("connection", async (ws: WSWebSocket, payload: IPayload) => {
    const { user, supabase } = payload;

    let connectionPcmFile: Deno.FsFile | null = null;
    if (isDev) {
        const filename = `debug_audio_${Date.now()}.pcm`;
        connectionPcmFile = await Deno.open(filename, {
            create: true,
            write: true,
            append: true,
        });
    }
    // send user details to client
    // when DEV_MODE is true, we send the default values 100, false, false
    ws.send(
        JSON.stringify({
            type: "auth",
            volume_control: user.device?.volume ?? 100,
            is_ota: user.device?.is_ota ?? false,
            is_reset: user.device?.is_reset ?? false,
            pitch_factor: user.personality?.pitch_factor ?? 1,
        }),
    );

    const isDoctor = user.user_info.user_type === "doctor";

    const chatHistory = await getChatHistory(
        supabase,
        user.user_id,
        user.personality?.key ?? null,
        isDoctor,
    );
    const firstMessage = createFirstMessage(chatHistory, payload);
    console.log("firstMessage", firstMessage);
    const systemPrompt = createSystemPrompt(chatHistory, payload);
    let sessionStartTime: number;
    let currentItemId: string | null = null;

    // Instantiate new client
    console.log(`Connecting with key "${openaiApiKey.slice(0, 3)}..."`);
    const client = new RealtimeClient({ apiKey: openaiApiKey });

    // Relay: OpenAI Realtime API Event -> Browser Event
    client.realtime.on("server.*", async (event: any) => {
        // console.log(`Relaying "${event.type}" to Client`);
        // Check if the event is session.created
        if (event.type === "session.created") {
            console.log("session created", event);
            sessionStartTime = Date.now();
            sendFirstMessage(client, firstMessage);
        } else if (event.type === "session.updated") {
            console.log("session updated", event);
        } else if (event.type === "error") {
            console.log("error", event);
        } else if (event.type === "response.done") {
            // Fetch the latest device info when response is complete
            try {
                const device = await getDeviceInfo(supabase, user.user_id);

                if (device) {
                    // Send the updated volume data along with the response complete message
                    ws.send(JSON.stringify({
                        type: "server",
                        msg: "RESPONSE.COMPLETE",
                        volume_control: device.volume ?? 100,
                    }));
                } else {
                    // Fall back to just sending the complete message if there's an error
                    ws.send(
                        JSON.stringify({
                            type: "server",
                            msg: "RESPONSE.COMPLETE",
                        }),
                    );
                }
            } catch (error) {
                console.error("Error fetching updated device info:", error);
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
                const { delta } = client.conversation.processEvent(event);

                switch (event.type) {
                    case "response.created":
                        console.log("response.created", event);
                        ws.send(
                            JSON.stringify({
                                type: "server",
                                msg: "RESPONSE.CREATED",
                            }),
                        );
                        break;
                    case "response.output_item.added":
                        console.log("response.output_item.added", event);
                        if (event.item.id) {
                            console.log("foobar", event.item.id);
                            currentItemId = event.item.id;
                        }
                        break;
                    case "response.audio.delta":
                        {
                            try {
                                if (delta?.audio?.buffer) {
                                    const pcmBuffer = Buffer.from(
                                        delta.audio.buffer,
                                    );
                                    for (
                                        let offset = 0;
                                        offset < pcmBuffer.length;
                                        offset += FRAME_SIZE
                                    ) {
                                        // Get one frame of PCM data.
                                        const frame = pcmBuffer.subarray(
                                            offset,
                                            offset + FRAME_SIZE,
                                        );

                                        try {
                                            const encodedPacket = encoder
                                                .encode(frame);
                                            ws.send(encodedPacket);
                                        } catch (_e) {
                                            // Skip this frame but continue with others
                                        }
                                    }
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

                    client.realtime.send("response.cancel", {
                        type: "response.cancel",
                        event_id: RealtimeUtils.generateId("evt_")
                    });

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
        if (sessionStartTime) {
            const sessionDuration = Math.floor(
                (Date.now() - sessionStartTime) / 1000,
            );
            await updateUserSessionTime(supabase, user, sessionDuration);
        }
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
            // turn_detection: null,
            turn_detection: {
                type: "server_vad",
                threshold: 0.4,
                prefix_padding_ms: 400,
                silence_duration_ms: 1000,
            },
            voice: user.personality?.oai_voice ?? "ash",
            instructions: systemPrompt,
            input_audio_transcription: { model: "whisper-1" },
        };
        await client.connect(sessionOptions);
    } catch (e: unknown) {
        console.log(`Error connecting to OpenAI: ${e as Error}`);
        ws.close();
        return;
    }
    console.log(`Connected to OpenAI successfully!`);
    while (messageQueue.length) {
        messageHandler(messageQueue.shift(), false);
    }
});

server.on("upgrade", async (req, socket, head) => {
    console.log("upgrade");
    let user: IUser;
    let supabase: SupabaseClient;
    let authToken: string;
    try {
        const { authorization: authHeader, "x-wifi-rssi": rssi } = req.headers;
        authToken = authHeader?.replace("Bearer ", "") ?? "";
        const wifiStrength = parseInt(rssi as string); // Convert to number

        // You can now use wifiStrength in your code
        console.log("WiFi RSSI:", wifiStrength); // Will log something like -50

        // Remove debug logging
        if (!authToken) {
            socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
            socket.destroy();
            return;
        }

        supabase = getSupabaseClient(authToken as string);
        user = await authenticateUser(supabase, authToken as string);
        console.log(user.email);
    } catch (_e: any) {
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        socket.destroy();
        return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit("connection", ws, {
            user,
            supabase,
            timestamp: new Date().toISOString(),
        });
    });
});

if (isDev) { // deno run -A --env-file=.env main.ts
    const HOST = Deno.env.get("HOST") || "0.0.0.0";
    const PORT = Deno.env.get("PORT") || "8000";
    server.listen(Number(PORT), HOST, () => {
        console.log(`Audio capture server running on ws://${HOST}:${PORT}`);
    });
} else {
    server.listen(8080);
}

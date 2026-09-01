import { Buffer } from "node:buffer";
import type { RawData } from "npm:@types/ws@^8.5.10";
import { WebSocket } from "npm:ws@^8.18.0";
import { addConversation, getDeviceInfo } from "../supabase.ts";
import {
    bosonApiKey,
    createOpusPacketizer,
    defaultBosonVoice,
    isDev,
    SAMPLE_RATE,
} from "../utils.ts";

const BOSON_REALTIME_URL = "wss://api.boson.ai/v1/realtime";
const BOSON_MODEL = Deno.env.get("BOSON_REALTIME_MODEL") || "higgs-realtime";
const BOSON_TRANSCRIPTION_MODEL = Deno.env.get("BOSON_TRANSCRIPTION_MODEL") || "higgs-stt-3.1";

const eventId = () => `evt_${crypto.randomUUID().replaceAll("-", "")}`;

const normalizeVoice = (voice?: string | null) => {
    if (!voice) return defaultBosonVoice;
    return voice.startsWith("voice_") ? voice : voice.toLowerCase();
};

export const connectToBoson = async ({
    ws,
    payload,
    connectionPcmFile,
    firstMessage,
    systemPrompt,
    closeHandler,
}: ProviderArgs) => {
    const { user, supabase } = payload;
    const clientWs = ws as any;

    if (!bosonApiKey) {
        throw new Error("BOSON_API_KEY is not set");
    }

    const voice = normalizeVoice(user.personality?.oai_voice);
    const opus = createOpusPacketizer((packet) => ws.send(packet));

    const bosonWs = new WebSocket(`${BOSON_REALTIME_URL}?model=${BOSON_MODEL}`, {
        headers: {
            Authorization: `Bearer ${bosonApiKey}`,
            "Content-Type": "application/json",
        },
    });

    let isConnected = false;
    let currentItemId: string | null = null;
    const messageQueue: Array<{ data: RawData; isBinary: boolean }> = [];

    const sendBoson = (event: Record<string, unknown>) => {
        bosonWs.send(JSON.stringify(event));
    };

    const sendResponseCreated = async () => {
        opus.reset();
        try {
            const device = await getDeviceInfo(supabase, user.user_id);
            ws.send(JSON.stringify({
                type: "server",
                msg: "RESPONSE.CREATED",
                volume_control: device?.volume ?? 100,
            }));
        } catch {
            ws.send(JSON.stringify({ type: "server", msg: "RESPONSE.CREATED" }));
        }
    };

    const sendFirstMessage = () => {
        if (!firstMessage.trim()) return;
        sendBoson({
            event_id: eventId(),
            type: "conversation.item.create",
            previous_item_id: "root",
            item: {
                type: "message",
                role: "user",
                content: [{ type: "input_text", text: firstMessage }],
            },
        });
        sendBoson({ event_id: eventId(), type: "response.create" });
    };

    const sendFunctionTools = () => ([
        {
            type: "function",
            name: "end_call",
            description:
                'End the voice session immediately when the user says goodbye, bye, or says they need to leave.',
            parameters: {
                type: "object",
                properties: {
                    reason: {
                        type: "string",
                        description: "Brief reason for ending the call.",
                    },
                },
            },
        },
        {
            type: "function",
            name: "end_session",
            description:
                'End the voice session immediately when the user says goodbye, bye, or says they need to leave.',
            parameters: {
                type: "object",
                properties: {
                    reason: {
                        type: "string",
                        description: "Brief reason for ending the session.",
                    },
                },
            },
        },
    ]);

    const handleToolCall = (event: any) => {
        const name = String(event.name || "");
        const callId = event.call_id;
        if (name === "end_call" || name === "end_session") {
            ws.send(JSON.stringify({ type: "server", msg: "SESSION.END" }));
            if (callId) {
                sendBoson({
                    event_id: eventId(),
                    type: "conversation.item.create",
                    item: {
                        type: "function_call_output",
                        call_id: callId,
                        output: JSON.stringify({ success: true, message: "Session ended" }),
                    },
                });
            }
        }
    };

    bosonWs.on("open", () => {
        isConnected = true;
        sendBoson({
            event_id: eventId(),
            type: "session.update",
            session: {
                type: "realtime",
                model: BOSON_MODEL,
                output_modalities: ["audio"],
                instructions: systemPrompt,
                audio: {
                    input: {
                        format: { type: "audio/pcm", rate: SAMPLE_RATE },
                        transcription: { model: BOSON_TRANSCRIPTION_MODEL },
                        turn_detection: null,
                    },
                    output: {
                        format: { type: "audio/pcm", rate: SAMPLE_RATE },
                        voice,
                    },
                },
                tools: sendFunctionTools(),
                tool_choice: "auto",
                temperature: Number(Deno.env.get("BOSON_TEMPERATURE") || "0.3"),
                truncation: "auto",
            },
        });

        while (messageQueue.length > 0) {
            const queued = messageQueue.shift();
            if (queued) {
                messageHandler(queued.data, queued.isBinary);
            }
        }
    });

    bosonWs.on("message", async (data: Buffer) => {
        let event: any;
        try {
            event = JSON.parse(data.toString("utf-8"));
        } catch {
            return;
        }

        try {
            switch (event.type) {
                case "session.created":
                    sendFirstMessage();
                    break;
                case "response.created":
                    await sendResponseCreated();
                    break;
                case "response.output_item.added":
                    currentItemId = event.item?.id ?? currentItemId;
                    break;
                case "response.output_audio.delta":
                    if (typeof event.delta === "string") {
                        opus.push(Buffer.from(event.delta, "base64"));
                    }
                    break;
                case "response.output_audio_transcript.done":
                    if (typeof event.transcript === "string" && event.transcript.trim()) {
                        await addConversation(supabase, "assistant", event.transcript, user);
                    }
                    break;
                case "conversation.item.input_audio_transcription.completed":
                    if (typeof event.transcript === "string" && event.transcript.trim()) {
                        await addConversation(supabase, "user", event.transcript, user);
                    }
                    break;
                case "input_audio_buffer.speech_started":
                    ws.send(JSON.stringify({ type: "server", msg: "RESPONSE.INTERRUPTED" }));
                    break;
                case "input_audio_buffer.committed":
                    ws.send(JSON.stringify({ type: "server", msg: "AUDIO.COMMITTED" }));
                    break;
                case "response.function_call_arguments.done":
                    handleToolCall(event);
                    break;
                case "response.done":
                    opus.flush(true);
                    if (event.response?.status !== "cancelled") {
                        ws.send(JSON.stringify({ type: "server", msg: "RESPONSE.COMPLETE" }));
                    }
                    break;
                case "error":
                    console.error("Boson realtime error:", event);
                    ws.send(JSON.stringify({ type: "server", msg: "RESPONSE.ERROR" }));
                    break;
            }
        } catch (err) {
            console.error("Error processing Boson event:", err);
            ws.send(JSON.stringify({ type: "server", msg: "RESPONSE.ERROR" }));
        }
    });

    bosonWs.on("close", () => {
        ws.close();
    });

    bosonWs.on("error", (error: any) => {
        console.error("Boson WebSocket error:", error);
        ws.send(JSON.stringify({ type: "server", msg: "RESPONSE.ERROR" }));
    });

    const messageHandler = async (data: RawData, isBinary: boolean) => {
        if (isBinary) {
            const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer);
            sendBoson({
                event_id: eventId(),
                type: "input_audio_buffer.append",
                audio: buffer.toString("base64"),
            });
            if (isDev && connectionPcmFile) {
                await connectionPcmFile.write(buffer);
            }
            return;
        }

        let message: any;
        try {
            message = JSON.parse(Buffer.from(data as any).toString("utf-8"));
        } catch {
            return;
        }

        if (message?.type !== "instruction") return;

        if (message.msg === "end_of_speech") {
            sendBoson({ event_id: eventId(), type: "input_audio_buffer.commit" });
            sendBoson({ event_id: eventId(), type: "response.create" });
            sendBoson({ event_id: eventId(), type: "input_audio_buffer.clear" });
        } else if (message.msg === "INTERRUPT") {
            sendBoson({ event_id: eventId(), type: "response.cancel" });
            if (currentItemId) {
                sendBoson({
                    event_id: eventId(),
                    type: "conversation.item.truncate",
                    item_id: currentItemId,
                    content_index: 0,
                    audio_end_ms: Number(message.audio_end_ms || 0),
                });
            }
            sendBoson({ event_id: eventId(), type: "input_audio_buffer.clear" });
        } else if (message.msg === "END_SESSION") {
            bosonWs.close();
        }
    };

    clientWs.on("message", (data: RawData, isBinary: boolean) => {
        if (!isConnected) {
            messageQueue.push({ data, isBinary });
        } else {
            messageHandler(data, isBinary);
        }
    });

    clientWs.on("error", (error: any) => {
        console.error("ESP32 WebSocket error:", error);
        bosonWs.close();
    });

    clientWs.on("close", async (code: number, reason: string) => {
        console.log(`ESP32 WebSocket closed with code ${code}, reason: ${reason}`);
        await closeHandler();
        opus.close();
        bosonWs.close();
        if (isDev && connectionPcmFile) {
            connectionPcmFile.close();
        }
    });

    await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("Boson connection timeout")), 10000);
        bosonWs.on("open", () => {
            clearTimeout(timeout);
            resolve();
        });
        bosonWs.on("error", (error: any) => {
            clearTimeout(timeout);
            reject(error);
        });
    });
};

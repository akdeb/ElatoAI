import { Buffer } from 'node:buffer';
import type { RawData } from 'npm:@types/ws';
import { WebSocket } from 'npm:ws';
import { addConversation } from '../supabase.ts';
import { createOpusPacketizer, isDev, openaiApiKey } from '../utils.ts';

/**
 * OpenAI GPT-Live bridge.
 *
 * GPT-Live is not a Realtime model: it runs on the separate Live API, owns
 * turn-taking, and per OpenAI's WebSocket guide "does not emit an
 * output-audio-done event". The ESP32 is a half-duplex state machine that needs
 * RESPONSE.CREATED to start playing and RESPONSE.COMPLETE to start listening,
 * so both boundaries are derived here from gaps in the output audio stream.
 *
 * The device has no acoustic echo cancellation, so its microphone would feed
 * the model its own voice and it would interrupt itself. Input is muted
 * server-side for the duration of every spoken turn.
 */

const OPENAI_LIVE_URL = 'wss://api.openai.com/v1/live/sessions';
const OPENAI_LIVE_MODEL = Deno.env.get('OPENAI_LIVE_MODEL') || 'gpt-live-1';
// GPT-Live delegates reasoning and tool use to a backend Responses model.
const OPENAI_LIVE_BACKEND_MODEL = Deno.env.get('OPENAI_LIVE_BACKEND_MODEL') || 'gpt-5.6-luna';
const OPENAI_LIVE_VOICE = Deno.env.get('OPENAI_LIVE_VOICE') || 'marin';
// Silence after which a spoken turn is treated as finished. GPT-Live pauses
// mid-turn by design and the firmware drops inbound audio once it leaves
// SPEAKING, so too low clips responses and too high delays listening.
const TURN_IDLE_MS = Number(Deno.env.get('OPENAI_LIVE_TURN_IDLE_MS') || '900');

const ESP32_INPUT_RATE = 16000;
// Live fixes one format for both directions at session.start; 24kHz is what the
// Opus packetizer already encodes from.
const OPENAI_LIVE_RATE = 24000;

function resamplePcm16Mono(input: Buffer, fromRate: number, toRate: number): Buffer {
    if (fromRate === toRate || input.length === 0) return input;

    const inputSamples = Math.floor(input.length / 2);
    const outputSamples = Math.max(1, Math.floor((inputSamples * toRate) / fromRate));
    const output = Buffer.alloc(outputSamples * 2);

    for (let i = 0; i < outputSamples; i++) {
        const sourcePosition = (i * fromRate) / toRate;
        const leftIndex = Math.floor(sourcePosition);
        const rightIndex = Math.min(leftIndex + 1, inputSamples - 1);
        const fraction = sourcePosition - leftIndex;
        const left = input.readInt16LE(leftIndex * 2);
        const right = input.readInt16LE(rightIndex * 2);
        output.writeInt16LE(Math.round(left + (right - left) * fraction), i * 2);
    }

    return output;
}

const eventId = () => `evt_${crypto.randomUUID().replace(/-/g, '')}`;

export const connectToOpenAILive = async ({
    ws,
    payload,
    connectionPcmFile,
    firstMessage,
    systemPrompt,
    closeHandler,
}: ProviderArgs) => {
    const { user, supabase } = payload;

    if (!openaiApiKey) {
        throw new Error('OPENAI_API_KEY is not set');
    }

    const voice = user.personality?.oai_voice || OPENAI_LIVE_VOICE;
    const opus = createOpusPacketizer((packet) => ws.send(packet));

    const liveWs = new WebSocket(OPENAI_LIVE_URL, {
        headers: {
            Authorization: `Bearer ${openaiApiKey}`,
            'Content-Type': 'application/json',
        },
    });

    let sessionReady = false;
    const messageQueue: Array<{ data: RawData; isBinary: boolean }> = [];

    let speaking = false;
    let inputMuted = false;
    let lastAudioAt = 0;
    let assistantTranscript = '';
    const pendingCalls = new Set<string>();

    const setInputMuted = (muted: boolean) => {
        if (muted === inputMuted) return;
        inputMuted = muted;
        liveWs.send(
            JSON.stringify({
                event_id: eventId(),
                type: muted ? 'session.input_audio.mute' : 'session.input_audio.unmute',
            }),
        );
    };

    const beginTurn = () => {
        if (speaking) return;
        speaking = true;
        assistantTranscript = '';
        opus.reset();
        setInputMuted(true);
        ws.send(
            JSON.stringify({
                type: 'server',
                msg: 'RESPONSE.CREATED',
                volume_control: user.device?.volume ?? 100,
            }),
        );
    };

    const endTurn = async () => {
        if (!speaking) return;
        speaking = false;
        lastAudioAt = 0;
        opus.flush(true);
        ws.send(JSON.stringify({ type: 'server', msg: 'RESPONSE.COMPLETE' }));
        setInputMuted(false);
        if (assistantTranscript.trim()) {
            await addConversation(supabase, 'assistant', assistantTranscript, user);
            assistantTranscript = '';
        }
    };

    // Audio arriving after a turn closes simply opens the next one, so a pause
    // longer than the threshold costs a re-announced turn, not a stuck session.
    const turnWatchdog = setInterval(() => {
        if (speaking && lastAudioAt && Date.now() - lastAudioAt >= TURN_IDLE_MS) {
            endTurn().catch((err) => console.error('Error ending GPT-Live turn:', err));
        }
    }, Math.min(TURN_IDLE_MS, 200));

    const sendFirstMessage = () => {
        if (!firstMessage.trim()) return;
        // Live has no conversation.item.create; commentary.append is the
        // documented way to give the model something to say aloud (it
        // paraphrases). delegation_id is required even when null.
        liveWs.send(
            JSON.stringify({
                event_id: eventId(),
                type: 'session.commentary.append',
                delegation_id: null,
                content: firstMessage,
            }),
        );
    };

    liveWs.on('open', () => {
        liveWs.send(
            JSON.stringify({
                event_id: eventId(),
                type: 'session.start',
                session: {
                    model: OPENAI_LIVE_MODEL,
                    instructions: systemPrompt,
                    audio: {
                        format: { type: 'audio/pcm', rate: OPENAI_LIVE_RATE },
                        output: { voice },
                    },
                    delegation: {
                        type: 'responses',
                        responses: {
                            model: OPENAI_LIVE_BACKEND_MODEL,
                            tools: [
                                {
                                    type: 'function',
                                    name: 'end_session',
                                    description:
                                        'Call this if the user says bye or needs to leave or suggests they want to end the session.',
                                    parameters: {
                                        type: 'object',
                                        properties: {
                                            reason: {
                                                type: 'string',
                                                description: 'Why the session is ending.',
                                            },
                                        },
                                        required: ['reason'],
                                    },
                                },
                            ],
                            tool_choice: 'auto',
                        },
                    },
                },
            }),
        );
    });

    const handleBackendEvent = (envelope: any) => {
        const event = envelope?.event;
        if (event?.type !== 'response.output_item.done') return;

        const item = event.item;
        if (item?.type !== 'function_call') return;

        const callId = item.call_id;
        if (!callId || pendingCalls.has(callId)) return;
        pendingCalls.add(callId);

        let result: Record<string, unknown> = { success: true };
        let endSession = false;
        if (item.name === 'end_session') {
            console.log('end session', item.arguments);
            endSession = true;
            result = { success: true, message: 'Session ended' };
            ws.send(JSON.stringify({ type: 'server', msg: 'SESSION.END' }));
        }

        liveWs.send(
            JSON.stringify({
                event_id: eventId(),
                type: 'response.item.create',
                item: {
                    type: 'function_call_output',
                    call_id: callId,
                    output: JSON.stringify(result),
                },
            }),
        );
        // Appending a result does not resume the backend on its own.
        if (!endSession) {
            liveWs.send(JSON.stringify({ event_id: eventId(), type: 'response.create' }));
        }
    };

    liveWs.on('message', async (data: Buffer) => {
        let event: any;
        try {
            event = JSON.parse(data.toString('utf-8'));
        } catch {
            return;
        }

        try {
            switch (event.type) {
                case 'session.started':
                    console.log(`GPT-Live session ready with model ${OPENAI_LIVE_MODEL}`);
                    sessionReady = true;
                    sendFirstMessage();
                    while (messageQueue.length > 0) {
                        const queued = messageQueue.shift();
                        if (queued) await messageHandler(queued.data, queued.isBinary);
                    }
                    break;

                case 'session.output_audio.delta':
                    if (typeof event.delta === 'string') {
                        beginTurn();
                        lastAudioAt = Date.now();
                        opus.push(Buffer.from(event.delta, 'base64'));
                    }
                    break;

                case 'session.output_transcript.delta':
                    if (typeof event.delta === 'string') assistantTranscript += event.delta;
                    break;

                case 'session.input_transcript.delta':
                    break;

                case 'response.event':
                    handleBackendEvent(event);
                    break;

                case 'session.closed':
                    console.log('GPT-Live session closed:', event.usage);
                    ws.close();
                    break;

                case 'error':
                    console.error('GPT-Live error:', event);
                    ws.send(JSON.stringify({ type: 'server', msg: 'RESPONSE.ERROR' }));
                    speaking = false;
                    opus.reset();
                    break;
            }
        } catch (err) {
            console.error('Error processing GPT-Live event:', err);
            ws.send(JSON.stringify({ type: 'server', msg: 'RESPONSE.ERROR' }));
            speaking = false;
            opus.reset();
        }
    });

    liveWs.on('close', () => {
        clearInterval(turnWatchdog);
        ws.close();
    });

    liveWs.on('error', (error: any) => {
        console.error('GPT-Live WebSocket error:', error);
        ws.send(JSON.stringify({ type: 'server', msg: 'RESPONSE.ERROR' }));
    });

    const messageHandler = async (data: RawData, isBinary: boolean) => {
        if (isBinary) {
            const inputPcm = Buffer.from(data as Buffer);
            const livePcm = resamplePcm16Mono(inputPcm, ESP32_INPUT_RATE, OPENAI_LIVE_RATE);
            liveWs.send(
                JSON.stringify({
                    event_id: eventId(),
                    type: 'session.input_audio.append',
                    audio: livePcm.toString('base64'),
                }),
            );

            if (isDev && connectionPcmFile) {
                await connectionPcmFile.write(data as Buffer);
            }
            return;
        }

        let message: any;
        try {
            message = JSON.parse((data as Buffer).toString('utf-8'));
        } catch {
            return;
        }

        if (message?.type !== 'instruction') return;

        // GPT-Live runs its own turn detection, and a muted half-duplex client
        // cannot barge in, so only an explicit end-of-session is actionable.
        if (message.msg === 'END_SESSION') {
            ws.send(JSON.stringify({ type: 'server', msg: 'SESSION.END' }));
            liveWs.send(JSON.stringify({ event_id: eventId(), type: 'session.close' }));
        }
    };

    ws.on('message', (data: RawData, isBinary: boolean) => {
        if (!sessionReady) {
            messageQueue.push({ data, isBinary });
        } else {
            messageHandler(data, isBinary);
        }
    });

    ws.on('error', (error: any) => {
        console.error('ESP32 WebSocket error:', error);
        liveWs.close();
    });

    ws.on('close', async (code: number, reason: string) => {
        console.log(`ESP32 WebSocket closed with code ${code}, reason: ${reason}`);
        clearInterval(turnWatchdog);
        await closeHandler();
        opus.close();
        liveWs.close();
        if (isDev && connectionPcmFile) {
            connectionPcmFile.close();
        }
    });

    return new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('GPT-Live connection timeout')), 10000);
        liveWs.on('open', () => {
            clearTimeout(timeout);
            resolve();
        });
        liveWs.on('error', (error: any) => {
            clearTimeout(timeout);
            reject(error);
        });
    });
};

import { Buffer } from 'node:buffer';
import type { RawData } from 'npm:@types/ws';
import { WebSocket } from 'npm:ws';
import { addConversation } from '../supabase.ts';
import { createOpusPacketizer, defaultGrokVoice, isDev, xaiApiKey } from '../utils.ts';

const XAI_REALTIME_URL = 'wss://api.x.ai/v1/realtime';
const GROK_REALTIME_MODEL = Deno.env.get('GROK_REALTIME_MODEL') || 'grok-voice-latest';
const ESP32_INPUT_RATE = 16000;
const GROK_PCM_RATE = 24000;

const normalizeVoice = (voice?: string | null) => (voice || defaultGrokVoice).toLowerCase();

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

export const connectToGrok = async ({
    ws,
    payload,
    connectionPcmFile,
    firstMessage,
    systemPrompt,
    closeHandler,
}: ProviderArgs) => {
    const { user, supabase } = payload;

    if (!xaiApiKey) {
        throw new Error('XAI_API_KEY is not set');
    }

    const voice = normalizeVoice(user.personality?.oai_voice);

    const opus = createOpusPacketizer((packet) => ws.send(packet));

    const grokWs = new WebSocket(
        `${XAI_REALTIME_URL}?model=${encodeURIComponent(GROK_REALTIME_MODEL)}`,
        {
            headers: {
                Authorization: `Bearer ${xaiApiKey}`,
                'Content-Type': 'application/json',
            },
        },
    );

    let sessionReady = false;
    let firstMessageSent = false;
    const messageQueue: Array<{ data: RawData; isBinary: boolean }> = [];

    let createdSent = false;
    let responseHasAudio = false;
    let outputTranscript = '';

    const ensureResponseStarted = () => {
        if (createdSent) return;
        ws.send(
            JSON.stringify({
                type: 'server',
                msg: 'RESPONSE.CREATED',
                volume_control: user.device?.volume ?? 100,
            }),
        );
        createdSent = true;
    };

    const sendFirstMessage = () => {
        if (firstMessageSent || !firstMessage.trim()) return;
        firstMessageSent = true;
        grokWs.send(
            JSON.stringify({
                type: 'conversation.item.create',
                item: {
                    type: 'message',
                    role: 'user',
                    content: [{ type: 'input_text', text: firstMessage }],
                },
            }),
        );
        grokWs.send(JSON.stringify({ type: 'response.create' }));
    };

    grokWs.on('open', () => {
        grokWs.send(
            JSON.stringify({
                type: 'session.update',
                session: {
                    voice,
                    instructions: systemPrompt,
                    turn_detection: {
                        type: 'server_vad',
                        threshold: Number(
                            Deno.env.get('GROK_ESP32_VAD_THRESHOLD') || '0.6',
                        ),
                        prefix_padding_ms: Number(
                            Deno.env.get('GROK_ESP32_VAD_PREFIX_PADDING_MS') || '400',
                        ),
                        silence_duration_ms: Number(
                            Deno.env.get('GROK_ESP32_VAD_SILENCE_MS') || '800',
                        ),
                    },
                    audio: {
                        input: {
                            format: { type: 'audio/pcm', rate: GROK_PCM_RATE },
                            transcription: { model: 'grok-transcribe' },
                        },
                        output: { format: { type: 'audio/pcm', rate: GROK_PCM_RATE } },
                    },
                },
            }),
        );
    });

    grokWs.on('message', async (data: Buffer) => {
        let event: any;
        try {
            event = JSON.parse(data.toString('utf-8'));
        } catch {
            return;
        }

        try {
            switch (event.type) {
                case 'session.created':
                    console.log('Grok session created');
                    break;

                case 'session.updated':
                    console.log(`Grok session ready with model ${GROK_REALTIME_MODEL}`);
                    sessionReady = true;
                    sendFirstMessage();
                    while (messageQueue.length > 0) {
                        const queuedMessage = messageQueue.shift();
                        if (queuedMessage) {
                            await messageHandler(queuedMessage.data, queuedMessage.isBinary);
                        }
                    }
                    break;

                case 'response.created':
                    // Do not switch the ESP32 to SPEAKING until audio actually arrives.
                    opus.reset();
                    responseHasAudio = false;
                    outputTranscript = '';
                    break;

                case 'response.output_audio_transcript.delta':
                    if (typeof event.delta === 'string') {
                        outputTranscript += event.delta;
                    }
                    break;

                case 'response.audio.delta':
                case 'response.output_audio.delta':
                    if (typeof event.delta === 'string') {
                        ensureResponseStarted();
                        responseHasAudio = true;
                        const pcmChunk = Buffer.from(event.delta, 'base64');
                        opus.push(pcmChunk);
                    }
                    break;

                case 'conversation.item.input_audio_transcription.completed':
                    if (typeof event.transcript === 'string' && event.transcript.length > 0) {
                        await addConversation(supabase, 'user', event.transcript, user);
                    }
                    break;

                case 'conversation.item.input_audio_transcription.updated':
                    if (typeof event.transcript === 'string' && event.transcript.length > 0) {
                        console.log(`Grok heard: ${event.transcript}`);
                    }
                    break;

                case 'input_audio_buffer.speech_started':
                    console.log('Grok VAD detected speech');
                    break;

                case 'input_audio_buffer.speech_stopped':
                    console.log('Grok VAD detected end of speech');
                    break;

                case 'input_audio_buffer.committed':
                    ws.send(JSON.stringify({ type: 'server', msg: 'AUDIO.COMMITTED' }));
                    break;

                case 'response.done':
                    console.log('Grok response done:', {
                        status: event.response?.status,
                        statusDetails: event.response?.status_details,
                        responseHasAudio,
                    });

                    if (outputTranscript) {
                        await addConversation(supabase, 'assistant', outputTranscript, user);
                        outputTranscript = '';
                    }

                    if (responseHasAudio) {
                        opus.flush(true);
                        ws.send(JSON.stringify({ type: 'server', msg: 'RESPONSE.COMPLETE' }));
                    } else {
                        opus.reset();
                        console.error('Grok response completed without audio:', event.response);
                        ws.send(JSON.stringify({ type: 'server', msg: 'RESPONSE.ERROR' }));
                    }
                    createdSent = false;
                    responseHasAudio = false;
                    break;

                case 'error':
                    console.error('Grok realtime error:', event);
                    ws.send(JSON.stringify({ type: 'server', msg: 'RESPONSE.ERROR' }));
                    createdSent = false;
                    responseHasAudio = false;
                    opus.reset();
                    break;
            }
        } catch (err) {
            console.error('Error processing Grok event:', err);
            ws.send(JSON.stringify({ type: 'server', msg: 'RESPONSE.ERROR' }));
            createdSent = false;
            responseHasAudio = false;
            opus.reset();
        }
    });

    grokWs.on('close', () => {
        ws.close();
    });

    grokWs.on('error', (error: any) => {
        console.error('Grok WebSocket error:', error);
        ws.send(JSON.stringify({ type: 'server', msg: 'RESPONSE.ERROR' }));
    });

    const messageHandler = async (data: RawData, isBinary: boolean) => {
        if (isBinary) {
            const inputPcm = Buffer.from(data as Buffer);
            const grokPcm = resamplePcm16Mono(inputPcm, ESP32_INPUT_RATE, GROK_PCM_RATE);
            const base64Data = grokPcm.toString('base64');
            grokWs.send(JSON.stringify({ type: 'input_audio_buffer.append', audio: base64Data }));

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

        // With server VAD enabled, xAI owns commit and response creation.
        if (message.msg === 'INTERRUPT') {
            if (createdSent) {
                grokWs.send(JSON.stringify({ type: 'response.cancel' }));
            }
            grokWs.send(JSON.stringify({ type: 'input_audio_buffer.clear' }));
            opus.reset();
            createdSent = false;
        } else if (message.msg === 'END_SESSION') {
            ws.send(JSON.stringify({ type: 'server', msg: 'SESSION.END' }));
            grokWs.close(1000, 'session ended by ESP32');
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
        grokWs.close();
    });

    ws.on('close', async (code: number, reason: string) => {
        console.log(`ESP32 WebSocket closed with code ${code}, reason: ${reason}`);
        await closeHandler();
        opus.close();
        grokWs.close();
        if (isDev && connectionPcmFile) {
            connectionPcmFile.close();
        }
    });

    return new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Grok connection timeout')), 10000);
        grokWs.on('open', () => {
            clearTimeout(timeout);
            resolve();
        });
        grokWs.on('error', (error: any) => {
            clearTimeout(timeout);
            reject(error);
        });
    });
};

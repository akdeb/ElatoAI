
import { Buffer } from 'node:buffer';
import type { RawData } from 'npm:@types/ws';
import { WebSocket } from 'npm:ws';
import { addConversation, getDeviceInfo } from '../supabase.ts';
import { encoder, FRAME_SIZE, isDev, xaiApiKey } from '../utils.ts';

const XAI_REALTIME_URL = 'wss://api.x.ai/v1/realtime';
const DEFAULT_GROK_VOICE = 'Ara';

export const connectToGrok = async (
	ws: WebSocket,
	payload: IPayload,
	connectionPcmFile: Deno.FsFile | null,
	firstMessage: string,
	systemPrompt: string,
) => {
    const { user, supabase } = payload;

    if (!xaiApiKey) {
        throw new Error('XAI_API_KEY is not set');
    }

    const voice = user.personality?.oai_voice ?? DEFAULT_GROK_VOICE;

    const grokWs = new WebSocket(XAI_REALTIME_URL, {
        headers: {
            Authorization: `Bearer ${xaiApiKey}`,
            'Content-Type': 'application/json',
        },
    });

    let isConnected = false;
    const messageQueue: RawData[] = [];

    let createdSent = false;
    let outputTranscript = '';
    let audioRemainder = Buffer.alloc(0);

    const sendResponseCreated = async () => {
        try {
            const device = await getDeviceInfo(supabase, user.user_id);
            ws.send(
                JSON.stringify({
                    type: 'server',
                    msg: 'RESPONSE.CREATED',
                    volume_control: device?.volume ?? 100,
                }),
            );
        } catch {
            ws.send(JSON.stringify({ type: 'server', msg: 'RESPONSE.CREATED' }));
        }
    };

    const sendFirstMessage = () => {
        if (!firstMessage) return;
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
        isConnected = true;

        grokWs.send(
            JSON.stringify({
                type: 'session.update',
                session: {
                    voice,
                    instructions: systemPrompt,
                    turn_detection: { type: "server_vad" },
                    audio: {
                        input: { format: { type: 'audio/pcm', rate: 16000 } },
                        output: { format: { type: 'audio/pcm', rate: 24000 } },
                    },
                },
            }),
        );

        sendFirstMessage();

        while (messageQueue.length > 0) {
            const queuedMessage = messageQueue.shift();
            if (queuedMessage) {
                messageHandler(queuedMessage, true);
            }
        }
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
                case 'response.created':
                    if (!createdSent) {
                        await sendResponseCreated();
                        createdSent = true;
                    }
                    break;

                case 'response.output_audio_transcript.delta':
                    if (typeof event.delta === 'string') {
                        outputTranscript += event.delta;
                    }
                    break;

                case 'response.output_audio.delta':
                    if (typeof event.delta === 'string') {
                        const pcmChunk = Buffer.from(event.delta, 'base64');
                        audioRemainder = Buffer.concat([audioRemainder, pcmChunk]);

                        while (audioRemainder.length >= FRAME_SIZE) {
                            const frame = audioRemainder.subarray(0, FRAME_SIZE);
                            audioRemainder = audioRemainder.subarray(FRAME_SIZE);
                            try {
                                const packet = encoder.encode(frame);
                                ws.send(packet);
                            } catch {
                                // Skip frame
                            }
                        }
                    }
                    break;

                case 'conversation.item.input_audio_transcription.completed':
                    if (typeof event.transcript === 'string' && event.transcript.length > 0) {
                        await addConversation(supabase, 'user', event.transcript, user);
                    }
                    break;

                case 'input_audio_buffer.committed':
                    ws.send(JSON.stringify({ type: 'server', msg: 'AUDIO.COMMITTED' }));
                    break;

                case 'response.done':
                    if (outputTranscript) {
                        await addConversation(supabase, 'assistant', outputTranscript, user);
                        outputTranscript = '';
                    }
                    ws.send(JSON.stringify({ type: 'server', msg: 'RESPONSE.COMPLETE' }));
                    createdSent = false;
                    break;

                case 'error':
                    ws.send(JSON.stringify({ type: 'server', msg: 'RESPONSE.ERROR' }));
                    createdSent = false;
                    break;
            }
        } catch (err) {
            console.error('Error processing Grok event:', err);
            ws.send(JSON.stringify({ type: 'server', msg: 'RESPONSE.ERROR' }));
            createdSent = false;
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
            const base64Data = (data as Buffer).toString('base64');
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

        if (message.msg === 'end_of_speech') {
            grokWs.send(JSON.stringify({ type: 'input_audio_buffer.commit' }));
            grokWs.send(JSON.stringify({ type: 'response.create' }));
            grokWs.send(JSON.stringify({ type: 'input_audio_buffer.clear' }));
        } else if (message.msg === 'INTERRUPT') {
            grokWs.send(JSON.stringify({ type: 'input_audio_buffer.clear' }));
        }
    };

    ws.on('message', (data: RawData, isBinary: boolean) => {
        if (!isConnected) {
            messageQueue.push(data);
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

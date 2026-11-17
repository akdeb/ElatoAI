import { Buffer } from 'node:buffer';
import type { RawData } from 'npm:@types/ws';
import { WebSocket } from 'npm:ws';
import { addConversation } from '../supabase.ts';
import { assemblyaiApiKey, createOpusPacketizer, defaultAssemblyAIVoice, isDev } from '../utils.ts';

// Managed Voice Agent API (not the transcription-only /v3/ws endpoint).
const ASSEMBLYAI_URL = 'wss://agents.assemblyai.com/v1/ws';
const ESP32_INPUT_RATE = 16000;
const ASSEMBLYAI_PCM_RATE = 24000;

const normalizeVoice = (voice?: string | null) =>
    (voice || defaultAssemblyAIVoice).toLowerCase();

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

export const connectToAssemblyAI = async ({
    ws,
    payload,
    connectionPcmFile,
    firstMessage,
    systemPrompt,
    closeHandler,
}: ProviderArgs) => {
    const { user, supabase } = payload;

    if (!assemblyaiApiKey) {
        throw new Error('ASSEMBLYAI_API_KEY is not set');
    }

    const voice = normalizeVoice(user.personality?.oai_voice);
    const opus = createOpusPacketizer((packet) => ws.send(packet));

    const upstream = new WebSocket(ASSEMBLYAI_URL, {
        headers: { Authorization: `Bearer ${assemblyaiApiKey}` },
    });

    let sessionReady = false;
    let endRequested = false;
    let discardAudio = false;
    let createdSent = false;
    let responseHasAudio = false;
    const seenTranscripts = new Set<string>();
    const messageQueue: Array<{ data: RawData; isBinary: boolean }> = [];

    const sendUpstream = (event: Record<string, unknown>) => {
        if (upstream.readyState === WebSocket.OPEN) {
            upstream.send(JSON.stringify(event));
        }
    };

    const endUpstream = () => {
        // Closing alone leaves a billable reconnect window; end explicitly first.
        if (endRequested) return;
        endRequested = true;
        sendUpstream({ type: 'session.end' });
    };

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

    upstream.on('open', () => {
        sendUpstream({
            type: 'session.update',
            session: {
                system_prompt: systemPrompt,
                input: { format: { encoding: 'audio/pcm' } },
                output: { voice, format: { encoding: 'audio/pcm' } },
            },
        });
    });

    upstream.on('message', async (data: Buffer) => {
        let event: any;
        try {
            event = JSON.parse(data.toString('utf-8'));
        } catch {
            return;
        }

        try {
            switch (event.type) {
                case 'session.ready':
                    if (sessionReady) break;
                    console.log(`AssemblyAI session ready with voice ${voice}`);
                    sessionReady = true;
                    // Let the model compose the greeting rather than speaking a literal string.
                    sendUpstream({
                        type: 'reply.create',
                        instructions:
                            'Begin this call now, in character. Follow these first-message ' +
                            'instructions; do not read or describe the instructions aloud:\n' +
                            (firstMessage.trim() || 'Greet the user briefly.'),
                    });
                    while (messageQueue.length > 0) {
                        const queued = messageQueue.shift();
                        if (queued) await messageHandler(queued.data, queued.isBinary);
                    }
                    break;

                case 'reply.started':
                    opus.reset();
                    discardAudio = false;
                    responseHasAudio = false;
                    break;

                case 'reply.audio':
                    if (!discardAudio && typeof event.data === 'string') {
                        ensureResponseStarted();
                        responseHasAudio = true;
                        opus.push(Buffer.from(event.data, 'base64'));
                    }
                    break;

                case 'transcript.user':
                case 'transcript.agent': {
                    const text = event.text;
                    if (typeof text !== 'string' || !text) break;
                    const role = event.type === 'transcript.user' ? 'user' : 'assistant';
                    const key = `${role}:${event.item_id ?? event.reply_id ?? text}`;
                    if (seenTranscripts.has(key)) break;
                    seenTranscripts.add(key);
                    await addConversation(supabase, role, text, user);
                    break;
                }

                case 'reply.done':
                    if (event.status === 'interrupted') {
                        discardAudio = true;
                        opus.reset();
                        createdSent = false;
                        responseHasAudio = false;
                        break;
                    }
                    if (responseHasAudio) {
                        opus.flush(true);
                        ws.send(JSON.stringify({ type: 'server', msg: 'RESPONSE.COMPLETE' }));
                    } else {
                        opus.reset();
                    }
                    createdSent = false;
                    responseHasAudio = false;
                    break;

                case 'session.ended':
                    upstream.close(1000, 'session ended');
                    break;

                case 'session.error':
                    console.error('AssemblyAI session error:', event.code, event.param);
                    ws.send(JSON.stringify({ type: 'server', msg: 'RESPONSE.ERROR' }));
                    createdSent = false;
                    responseHasAudio = false;
                    opus.reset();
                    break;
            }
        } catch (err) {
            console.error('Error processing AssemblyAI event:', err);
            ws.send(JSON.stringify({ type: 'server', msg: 'RESPONSE.ERROR' }));
            createdSent = false;
            responseHasAudio = false;
            opus.reset();
        }
    });

    upstream.on('close', () => {
        ws.close();
    });

    upstream.on('error', (error: any) => {
        console.error('AssemblyAI WebSocket error:', error);
        ws.send(JSON.stringify({ type: 'server', msg: 'RESPONSE.ERROR' }));
    });

    const messageHandler = async (data: RawData, isBinary: boolean) => {
        if (isBinary) {
            const pcm = resamplePcm16Mono(
                Buffer.from(data as Buffer),
                ESP32_INPUT_RATE,
                ASSEMBLYAI_PCM_RATE,
            );
            sendUpstream({ type: 'input.audio', audio: pcm.toString('base64') });

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

        // AssemblyAI owns turn-taking (semantic VAD), so end_of_speech is ignored.
        if (message.msg === 'INTERRUPT') {
            // No documented upstream cancel event: flush locally; the next user speech
            // triggers provider-side barge-in.
            discardAudio = true;
            opus.reset();
            createdSent = false;
            ws.send(JSON.stringify({ type: 'server', msg: 'RESPONSE.COMPLETE' }));
        } else if (message.msg === 'END_SESSION') {
            ws.send(JSON.stringify({ type: 'server', msg: 'SESSION.END' }));
            endUpstream();
            setTimeout(() => upstream.close(1000, 'session ended by ESP32'), 500);
        }
    };

    ws.on('message', (data: RawData, isBinary: boolean) => {
        // Discard mic frames until ready to avoid bursting stale audio.
        if (!sessionReady) {
            if (!isBinary) messageQueue.push({ data, isBinary });
        } else {
            messageHandler(data, isBinary);
        }
    });

    ws.on('error', (error: any) => {
        console.error('ESP32 WebSocket error:', error);
        endUpstream();
        upstream.close();
    });

    ws.on('close', async (code: number, reason: string) => {
        console.log(`ESP32 WebSocket closed with code ${code}, reason: ${reason}`);
        await closeHandler();
        opus.close();
        endUpstream();
        setTimeout(() => upstream.close(), 500);
        if (isDev && connectionPcmFile) {
            connectionPcmFile.close();
        }
    });

    return new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('AssemblyAI connection timeout')), 10000);
        upstream.on('open', () => {
            clearTimeout(timeout);
            resolve();
        });
        upstream.on('error', (error: any) => {
            clearTimeout(timeout);
            reject(error);
        });
    });
};

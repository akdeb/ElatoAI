import { Buffer } from 'node:buffer';
import type { RawData } from 'npm:@types/ws';
import { WebSocket } from 'npm:ws';
import { addConversation } from '../supabase.ts';
import {
    assemblyaiApiKey,
    assemblyaiLlmModel,
    createOpusPacketizer,
    defaultAssemblyAIPipelineVoice,
    isDev,
} from '../utils.ts';

// AssemblyAI as separate building blocks, so you pick each model:
//   mic -> Streaming STT (Universal-3.6 Pro) -> LLM Gateway -> Text-to-Speech -> speaker
// The managed, single-socket alternative is models/assemblyai.ts (Voice Agent API).

const MIC_RATE = 16000; // ESP32 -> server
const TTS_RATE = 24000; // server -> ESP32 (Opus-encoded before it leaves)

const STT_URL = 'wss://streaming.assemblyai.com/v3/ws?' +
    new URLSearchParams({ speech_model: 'universal-3-6-pro', sample_rate: String(MIC_RATE) });
const LLM_URL = 'https://llm-gateway.assemblyai.com/v1/chat/completions';
const ttsUrl = (voiceId: string) =>
    'wss://tts.us.assemblyai.com/v1/ws?' +
    new URLSearchParams({
        voice_id: voiceId,
        language: 'english',
        sample_rate: String(TTS_RATE),
        encoding: 'pcm_s16le',
    });

type Msg = { role: 'system' | 'user' | 'assistant'; content: string };
// A queued turn. `hidden` turns (the greeting) are sent to the LLM but not logged as user speech.
type Turn = { text: string; hidden?: boolean };

const think = async (messages: Msg[]): Promise<string> => {
    const res = await fetch(LLM_URL, {
        method: 'POST',
        headers: { Authorization: assemblyaiApiKey!, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: assemblyaiLlmModel, messages, max_tokens: 200 }),
    });
    if (!res.ok) throw new Error(`LLM Gateway ${res.status}: ${await res.text()}`);
    const json = await res.json();
    return json.choices[0].message.content.trim();
};

export const connectToAssemblyAIPipeline = async ({
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

    const voiceId = user.personality?.oai_voice || defaultAssemblyAIPipelineVoice;
    const opus = createOpusPacketizer((packet) => ws.send(packet));
    const history: Msg[] = [{ role: 'system', content: systemPrompt }];
    const turns: Turn[] = [];

    let speaking = false;
    let working = false;
    let createdSent = false;
    let closed = false;
    let tts: WebSocket | null = null;

    const sendDevice = (event: Record<string, unknown>) => {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(event));
    };

    const ensureResponseStarted = () => {
        if (createdSent) return;
        sendDevice({
            type: 'server',
            msg: 'RESPONSE.CREATED',
            volume_control: user.device?.volume ?? 100,
        });
        createdSent = true;
    };

    // --- Speech-to-text (always listening) --------------------------------
    const stt = new WebSocket(STT_URL, { headers: { Authorization: assemblyaiApiKey } });

    stt.on('message', (data: Buffer) => {
        let msg: any;
        try {
            msg = JSON.parse(data.toString('utf-8'));
        } catch {
            return;
        }
        if (msg.type !== 'Turn') return;
        const text = typeof msg.transcript === 'string' ? msg.transcript.trim() : '';
        if (!text) return;

        if (speaking) interrupt(); // barge-in: the user spoke over the agent
        if (msg.end_of_turn) {
            turns.push({ text });
            void drain();
        }
    });

    // --- Text-to-speech (one socket per reply) -----------------------------
    function interrupt() {
        if (tts?.readyState === WebSocket.OPEN) tts.send(JSON.stringify({ type: 'Cancel' }));
        speaking = false;
        opus.reset();
        if (createdSent) {
            sendDevice({ type: 'server', msg: 'RESPONSE.COMPLETE' });
            createdSent = false;
        }
    }

    function speak(text: string): Promise<void> {
        return new Promise((resolve) => {
            const sock = new WebSocket(ttsUrl(voiceId), {
                headers: { Authorization: assemblyaiApiKey! },
            });
            tts = sock;
            speaking = true;
            sock.on('open', () => {
                sock.send(JSON.stringify({ type: 'Generate', text }));
                sock.send(JSON.stringify({ type: 'Flush' }));
            });
            sock.on('message', (data: Buffer) => {
                let msg: any;
                try {
                    msg = JSON.parse(data.toString('utf-8'));
                } catch {
                    return;
                }
                if (msg.type === 'Audio' && speaking) {
                    ensureResponseStarted();
                    opus.push(Buffer.from(msg.audio, 'base64')); // PCM16 @ 24 kHz -> Opus
                } else if (
                    msg.type === 'FlushDone' || msg.type === 'Cancelled' || msg.type === 'Error'
                ) {
                    if (msg.type === 'Error') console.error('AssemblyAI TTS error:', msg);
                    sock.send(JSON.stringify({ type: 'Terminate' }));
                }
            });
            sock.on('close', () => {
                if (speaking && createdSent) {
                    // Finished normally (not interrupted).
                    opus.flush(true);
                    sendDevice({ type: 'server', msg: 'RESPONSE.COMPLETE' });
                    createdSent = false;
                }
                speaking = false;
                resolve();
            });
            sock.on('error', () => sock.close());
        });
    }

    // --- Turn loop: one reply at a time ------------------------------------
    async function drain() {
        if (working) return;
        working = true;
        try {
            while (turns.length && !closed) {
                const turn = turns.shift()!;
                history.push({ role: 'user', content: turn.text });
                if (!turn.hidden) await addConversation(supabase, 'user', turn.text, user);
                const answer = await think(history);
                history.push({ role: 'assistant', content: answer });
                await addConversation(supabase, 'assistant', answer, user);
                if (!closed) await speak(answer);
            }
        } catch (err) {
            console.error('AssemblyAI pipeline error:', err);
            sendDevice({ type: 'server', msg: 'RESPONSE.ERROR' });
            createdSent = false;
            opus.reset();
        } finally {
            working = false;
        }
    }

    // --- Device -> server ---------------------------------------------------
    const messageHandler = async (data: RawData, isBinary: boolean) => {
        if (isBinary) {
            if (stt.readyState === WebSocket.OPEN) stt.send(data as Buffer); // mic PCM16 @ 16 kHz
            if (isDev && connectionPcmFile) await connectionPcmFile.write(data as Buffer);
            return;
        }

        let message: any;
        try {
            message = JSON.parse((data as Buffer).toString('utf-8'));
        } catch {
            return;
        }
        if (message?.type !== 'instruction') return;

        // AssemblyAI's turn detection decides when the user is done, so end_of_speech is ignored.
        if (message.msg === 'INTERRUPT') {
            interrupt();
        } else if (message.msg === 'END_SESSION') {
            sendDevice({ type: 'server', msg: 'SESSION.END' });
            shutdown();
        }
    };

    function shutdown() {
        if (closed) return;
        closed = true;
        turns.length = 0;
        if (stt.readyState === WebSocket.OPEN) stt.send(JSON.stringify({ type: 'Terminate' }));
        tts?.close();
        setTimeout(() => stt.close(), 500);
    }

    ws.on('message', (data: RawData, isBinary: boolean) => {
        messageHandler(data, isBinary);
    });

    ws.on('error', (error: any) => {
        console.error('ESP32 WebSocket error:', error);
        shutdown();
    });

    ws.on('close', async (code: number, reason: string) => {
        console.log(`ESP32 WebSocket closed with code ${code}, reason: ${reason}`);
        await closeHandler();
        opus.close();
        shutdown();
        if (isDev && connectionPcmFile) connectionPcmFile.close();
    });

    stt.on('close', () => {
        if (!closed) ws.close();
    });

    stt.on('error', (error: any) => {
        console.error('AssemblyAI STT error:', error);
        sendDevice({ type: 'server', msg: 'RESPONSE.ERROR' });
    });

    return new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('AssemblyAI connection timeout')), 10000);
        stt.on('open', () => {
            clearTimeout(timeout);
            console.log(`AssemblyAI pipeline ready (LLM ${assemblyaiLlmModel}, voice ${voiceId})`);
            // Let the model compose the greeting from the character's first-message instructions.
            turns.push({
                hidden: true,
                text:
                    'Begin this call now, in character. Follow these first-message instructions; ' +
                    'do not read or describe the instructions aloud:\n' +
                    (firstMessage.trim() || 'Greet the user briefly.'),
            });
            void drain();
            resolve();
        });
        stt.on('error', (error: any) => {
            clearTimeout(timeout);
            reject(error);
        });
    });
};

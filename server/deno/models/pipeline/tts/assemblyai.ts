// AssemblyAI TTS-1 over one WebSocket kept open for the whole call, so no reply pays a
// handshake. Each sentence is sent as Generate + Flush; audio arrives as 24 kHz PCM.
import { Buffer } from 'node:buffer';
import { assemblyaiApiKey, defaultAssemblyAIVoice, SAMPLE_RATE } from '../../../utils.ts';
import { AsyncQueue, env, type TtsProvider, type TtsSession, type TtsUtterance } from '../types.ts';

const REGION = (env('ASSEMBLYAI_REGION') ?? 'us').toLowerCase() === 'eu' ? 'eu' : 'us';
const HOST = `tts.${REGION}.assemblyai.com`;
const CONNECT_TIMEOUT_MS = 10000;

// A voice is a library slug such as `aai-kyla`, a cloned voice id, or a bare name (`kyla`).
export const normalizeAssemblyAIVoice = (voice?: string | null) => {
    const v = (voice || defaultAssemblyAIVoice).trim();
    if (/^aai-/i.test(v) || /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(v) || v.length > 24) return v;
    return `aai-${v.toLowerCase()}`;
};

type Pending = { q: AsyncQueue<Buffer>; flushesSent: number; flushesDone: number; ended: boolean };

export const assemblyaiTts: TtsProvider = {
    id: 'assemblyai',
    async open(voice): Promise<TtsSession> {
        if (!assemblyaiApiKey) throw new Error('ASSEMBLYAI_API_KEY is not set');
        const apiKey = assemblyaiApiKey;
        // ASSEMBLYAI_TTS_VOICE (e.g. a cloned voice id) overrides every character's voice.
        const voiceId = env('ASSEMBLYAI_TTS_VOICE') || normalizeAssemblyAIVoice(voice);
        const url = `wss://${HOST}/v1/ws?` + new URLSearchParams({
            voice_id: voiceId,
            sample_rate: String(SAMPLE_RATE),
            encoding: 'pcm_s16le',
            word_boundaries: 'false',
        });

        let sock: WebSocket | null = null;
        let ready = false;
        let frames: string[] = []; // waiting for Begin
        let pendingCancels = 0; // audio before `Cancelled` belongs to a cancelled reply
        let active: Pending | null = null;
        let closed = false;

        const finishIfDone = (p: Pending) => {
            if (p.ended && p.flushesDone >= p.flushesSent) p.q.end();
        };

        const connect = (): Promise<void> => {
            const s = new WebSocket(url, { headers: { Authorization: apiKey } } as any);
            sock = s;
            ready = false;
            pendingCancels = 0;
            return new Promise<void>((resolve, reject) => {
                s.addEventListener('message', (ev) => {
                    if (typeof ev.data !== 'string') return;
                    let msg: any;
                    try {
                        msg = JSON.parse(ev.data);
                    } catch {
                        return;
                    }
                    switch (msg.type) {
                        case 'Begin':
                            ready = true;
                            for (const f of frames) s.send(f);
                            frames = [];
                            resolve();
                            break;
                        case 'Audio':
                            if (pendingCancels > 0 || !active || typeof msg.audio !== 'string') break;
                            active.q.push(Buffer.from(msg.audio, 'base64'));
                            break;
                        case 'FlushDone':
                            if (pendingCancels > 0 || !active) break;
                            active.flushesDone++;
                            finishIfDone(active);
                            break;
                        case 'Cancelled':
                            pendingCancels = Math.max(0, pendingCancels - 1);
                            break;
                        case 'Error':
                            console.error('AssemblyAI TTS error:', msg);
                            break;
                    }
                });
                s.addEventListener('error', () => reject(new Error('AssemblyAI TTS socket error')));
                s.addEventListener('close', () => {
                    if (sock === s) sock = null;
                    reject(new Error('AssemblyAI TTS closed before Begin'));
                    // Don't leave a reply hanging on a dead socket.
                    if (active) active.q.end();
                });
            });
        };

        const send = (frame: Record<string, unknown>) => {
            if (closed) return;
            if (!sock || sock.readyState > WebSocket.OPEN) connect().catch(() => {});
            const data = JSON.stringify(frame);
            if (ready && sock?.readyState === WebSocket.OPEN) sock.send(data);
            else frames.push(data);
        };

        await Promise.race([
            connect(),
            new Promise<void>((_, rej) => setTimeout(() => rej(new Error('AssemblyAI TTS connection timeout')), CONNECT_TIMEOUT_MS)),
        ]);

        return {
            utterance(): TtsUtterance {
                const p: Pending = { q: new AsyncQueue<Buffer>(), flushesSent: 0, flushesDone: 0, ended: false };
                active = p;
                return {
                    say(text) {
                        if (active !== p || p.ended) return;
                        // Join sentences with a space: consecutive Generate frames are concatenated as is.
                        send({ type: 'Generate', text: text + ' ' });
                        send({ type: 'Flush' });
                        p.flushesSent++;
                    },
                    end() {
                        p.ended = true;
                        finishIfDone(p);
                    },
                    cancel() {
                        if (active === p) active = null;
                        if (p.flushesSent > p.flushesDone) {
                            if (ready && sock?.readyState === WebSocket.OPEN) {
                                pendingCancels++;
                                sock.send(JSON.stringify({ type: 'Cancel' }));
                            } else {
                                frames = []; // never sent, nothing to cancel
                            }
                        }
                        p.q.clear();
                        p.q.end();
                    },
                    audio: p.q,
                };
            },
            // Idle TTS sessions close after two minutes; a character can be quiet for longer.
            keepAlive() {
                if (ready && sock?.readyState === WebSocket.OPEN && !active) {
                    sock.send(JSON.stringify({ type: 'KeepAlive' }));
                }
            },
            close() {
                closed = true;
                const s = sock;
                if (s?.readyState === WebSocket.OPEN) s.send(JSON.stringify({ type: 'Terminate' }));
                setTimeout(() => s?.close(), 500);
            },
        };
    },
};

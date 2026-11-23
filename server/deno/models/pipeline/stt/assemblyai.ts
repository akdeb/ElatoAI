// AssemblyAI Streaming STT. One socket for the whole call; AssemblyAI's own turn detection
// decides when the user is done, so no local VAD is needed.
import { Buffer } from 'node:buffer';
import { assemblyaiApiKey, assemblyaiSttModel } from '../../../utils.ts';
import { env, MIC_RATE, type SttEvents, type SttProvider, type SttSession } from '../types.ts';

const REGION = (env('ASSEMBLYAI_REGION') ?? 'us').toLowerCase() === 'eu' ? 'eu' : 'us';
const HOST = REGION === 'eu' ? 'streaming.eu.assemblyai.com' : 'streaming.assemblyai.com';
const MIN_CHUNK_BYTES = (MIC_RATE * 2 * 50) / 1000; // STT wants >= 50 ms per frame

export const assemblyaiStt: SttProvider = {
    id: 'assemblyai',
    open(events: SttEvents): Promise<SttSession> {
        if (!assemblyaiApiKey) return Promise.reject(new Error('ASSEMBLYAI_API_KEY is not set'));
        const apiKey = assemblyaiApiKey;
        const url = `wss://${HOST}/v3/ws?` + new URLSearchParams({
            speech_model: assemblyaiSttModel,
            sample_rate: String(MIC_RATE),
            min_turn_silence: env('ASSEMBLYAI_MIN_TURN_SILENCE') ?? '160',
            max_turn_silence: env('ASSEMBLYAI_MAX_TURN_SILENCE') ?? '400',
        });

        let sock: WebSocket | null = null;
        let ready = false;
        let closed = false;
        let retries = 0;
        let lastTurnOrder = -1;
        let buf: Buffer = Buffer.alloc(0);
        // Diagnostics: how much audio AssemblyAI needed after the last word to end the turn,
        // and how loud the mic was meanwhile (room noise that reads as speech delays the end).
        let audioMs = 0; // audio sent this session, in ms
        const levels: { atMs: number; rms: number }[] = []; // per pushed chunk, last ~5 s
        const rms = (pcm: Buffer) => {
            const n = pcm.length >> 1;
            let sum = 0;
            for (let i = 0; i < n; i++) { const v = pcm.readInt16LE(i * 2); sum += v * v; }
            return n ? Math.sqrt(sum / n) : 0;
        };
        const avgRms = (fromMs: number, toMs: number) => {
            const xs = levels.filter((l) => l.atMs > fromMs && l.atMs <= toMs).map((l) => l.rms);
            return xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : -1;
        };

        const connect = (): Promise<void> => {
            const s = new WebSocket(url, { headers: { Authorization: apiKey } } as any);
            s.binaryType = 'arraybuffer';
            sock = s;
            ready = false;
            return new Promise<void>((resolve, reject) => {
                s.addEventListener('message', (ev) => {
                    if (typeof ev.data !== 'string') return;
                    let msg: any;
                    try {
                        msg = JSON.parse(ev.data);
                    } catch {
                        return;
                    }
                    if (msg.type === 'Begin') {
                        ready = true;
                        retries = 0;
                        resolve();
                    } else if (msg.type === 'Turn') {
                        const text = typeof msg.transcript === 'string' ? msg.transcript.trim() : '';
                        if (!msg.end_of_turn) {
                            if (text) events.onPartial(text);
                            return;
                        }
                        if (typeof msg.turn_order === 'number') {
                            if (msg.turn_order <= lastTurnOrder) return; // already handled
                            lastTurnOrder = msg.turn_order;
                        }
                        const words: any[] = Array.isArray(msg.words) ? msg.words : [];
                        const first = words[0], last = words.at(-1);
                        if (last && typeof last.end === 'number') {
                            const gap = Math.round(audioMs - last.end);
                            console.log(
                                `[stt assemblyai] end_of_turn ${gap}ms after last word` +
                                    ` | mic rms: speech=${avgRms(first?.start ?? 0, last.end)} gap=${avgRms(last.end, audioMs)}` +
                                    ` | conf=${msg.end_of_turn_confidence ?? '?'}`,
                            );
                        }
                        if (text) events.onPartial(text);
                        events.onTurn(text);
                    } else if (msg.error || msg.type === 'Error') {
                        console.error('AssemblyAI STT error:', msg);
                    }
                });
                s.addEventListener('error', () => reject(new Error('AssemblyAI STT socket error')));
                s.addEventListener('close', (ev) => {
                    ready = false;
                    reject(new Error(`AssemblyAI STT closed (${ev.code})`));
                    if (sock !== s || closed) return;
                    // Session limit or a network blip: reconnect so the call keeps going.
                    if (retries++ < 5) {
                        console.warn(`AssemblyAI STT closed (${ev.code} ${ev.reason}), reconnecting`);
                        setTimeout(() => !closed && connect().catch(() => {}), 500 * retries);
                    }
                });
            });
        };

        const session: SttSession = {
            push(pcm) {
                if (!ready || !sock || sock.readyState !== WebSocket.OPEN) return;
                buf = buf.length ? Buffer.concat([buf, pcm]) : pcm;
                if (buf.length >= MIN_CHUNK_BYTES) {
                    sock.send(buf);
                    audioMs += buf.length / ((MIC_RATE * 2) / 1000);
                    levels.push({ atMs: audioMs, rms: rms(buf) });
                    while (levels.length && levels[0].atMs < audioMs - 5000) levels.shift();
                    buf = Buffer.alloc(0);
                }
            },
            close() {
                closed = true;
                const s = sock;
                // Terminate first so the session is billed only for the call.
                if (s?.readyState === WebSocket.OPEN) s.send(JSON.stringify({ type: 'Terminate' }));
                setTimeout(() => s?.close(), 500);
            },
        };
        return connect().then(() => session);
    },
};

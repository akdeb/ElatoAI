// Mistral Voxtral Realtime STT. Voxtral transcribes but does not detect turns, so this
// plug-in runs an energy VAD on the mic stream: an utterance starts when speech is heard,
// streams to a pre-warmed Voxtral socket, and ends after a stretch of silence.
import { Buffer } from 'node:buffer';
import type { RawData } from 'npm:@types/ws@^8.5.10';
import { WebSocket } from 'npm:ws@^8.18.0';
import { mistralApiKey } from '../../../utils.ts';
import { env, MIC_RATE, type SttEvents, type SttProvider, type SttSession } from '../types.ts';

const STT_URL = 'wss://api.mistral.ai/v1/audio/transcriptions/realtime';
const MODEL = env('MISTRAL_STT_MODEL') ?? 'voxtral-mini-transcribe-realtime-3';
const DELAY_MS = Number(env('MISTRAL_STT_DELAY_MS') ?? '200');

// Speech must exceed max(VAD_MIN_LEVEL, noise floor * VAD_SNR). The floor adapts to the room.
const VAD_MIN_LEVEL = Number(env('MISTRAL_VAD_THRESHOLD') ?? '120'); // RMS of int16
const VAD_SNR = Number(env('MISTRAL_VAD_SNR') ?? '3');
const VAD_SILENCE_MS = Number(env('MISTRAL_VAD_SILENCE_MS') ?? '550');
const VAD_DEBUG = env('MISTRAL_VAD_DEBUG') === 'True';
const VAD_MIN_SPEECH_MS = 120;
const VAD_PREROLL_MS = 300;
const BYTES_PER_MS = (MIC_RATE * 2) / 1000;
const RETRIES = 2; // Voxtral sometimes answers TooManyRequests: replay on a fresh socket

const rms = (pcm: Buffer) => {
    const n = pcm.length >> 1;
    if (!n) return 0;
    let sum = 0;
    for (let i = 0; i < n; i++) {
        const s = pcm.readInt16LE(i * 2);
        sum += s * s;
    }
    return Math.sqrt(sum / n);
};

type Stream = {
    sock: WebSocket;
    ready: Promise<void>;
    text: string;
    done: Promise<string>;
    failed: boolean;
};

const openStream = (apiKey: string): Stream => {
    const sock = new WebSocket(`${STT_URL}?model=${MODEL}`, { headers: { Authorization: `Bearer ${apiKey}` } });
    let finish!: () => void;
    const st: Stream = {
        sock,
        text: '',
        failed: false,
        done: new Promise<string>((r) => (finish = () => r(st.text))),
        ready: new Promise<void>((resolve, reject) => {
            sock.on('error', (e: any) => {
                reject(e);
                finish();
            });
            sock.on('message', (data: RawData) => {
                let ev: any;
                try {
                    ev = JSON.parse(data.toString());
                } catch {
                    return;
                }
                switch (ev.type) {
                    case 'session.created':
                        sock.send(JSON.stringify({
                            type: 'session.update',
                            session: {
                                audio_format: { encoding: 'pcm_s16le', sample_rate: MIC_RATE },
                                target_streaming_delay_ms: DELAY_MS,
                            },
                        }));
                        resolve();
                        break;
                    case 'transcription.text.delta':
                        st.text += ev.text ?? '';
                        break;
                    case 'transcription.done':
                        if (typeof ev.text === 'string' && ev.text.trim()) st.text = ev.text;
                        finish();
                        break;
                    case 'error':
                        console.error('Mistral STT error:', ev);
                        st.failed = true;
                        finish();
                        break;
                }
            });
            sock.on('close', () => {
                reject(new Error('Mistral STT closed'));
                finish();
            });
        }),
    };
    st.ready.catch(() => {});
    return st;
};

const append = (st: Stream, pcm: Buffer) => {
    if (st.sock.readyState === WebSocket.OPEN) {
        st.sock.send(JSON.stringify({ type: 'input_audio.append', audio: pcm.toString('base64') }));
    }
};

const finishStream = async (st: Stream): Promise<string> => {
    if (st.sock.readyState === WebSocket.OPEN) {
        st.sock.send(JSON.stringify({ type: 'input_audio.flush' }));
        st.sock.send(JSON.stringify({ type: 'input_audio.end' }));
    }
    const text = await Promise.race([st.done, new Promise<string>((r) => setTimeout(() => r(st.text), 3000))]);
    st.sock.close();
    return text.trim();
};

export const mistralStt: SttProvider = {
    id: 'mistral',
    async open(events: SttEvents): Promise<SttSession> {
        if (!mistralApiKey) throw new Error('MISTRAL_API_KEY is not set');
        const apiKey = mistralApiKey;
        let closed = false;

        // One spare socket is kept warm so a turn never pays the handshake.
        let warm: Stream | null = openStream(apiKey);
        const take = (): Stream => {
            const s = warm && warm.sock.readyState <= WebSocket.OPEN ? warm : openStream(apiKey);
            warm = null; // the next spare opens after this one finishes
            return s;
        };
        const rewarm = () => {
            if (!closed && !warm) warm = openStream(apiKey);
        };

        let speaking = false;
        let speechMs = 0;
        let silenceMs = 0;
        let noiseFloor = 0;
        let lastLog = 0;
        let current: Stream | null = null;
        let utterance: Buffer[] = []; // kept so a failed stream can be replayed
        const preroll: Buffer[] = [];
        let prerollBytes = 0;

        const send = (st: Stream, pcm: Buffer) => {
            utterance.push(pcm);
            st.ready.then(() => append(st, pcm)).catch(() => {});
        };

        const retry = async (audio: Buffer[]): Promise<string> => {
            for (let attempt = 1; attempt <= RETRIES; attempt++) {
                await new Promise((r) => setTimeout(r, 250 * attempt));
                warm?.sock.close(); // keep a single live stream while retrying
                warm = null;
                const fresh = openStream(apiKey);
                try {
                    await fresh.ready;
                } catch {
                    continue;
                }
                for (const chunk of audio) append(fresh, chunk);
                const text = await finishStream(fresh);
                if (text || !fresh.failed) return text;
            }
            return '';
        };

        const endOfSpeech = async () => {
            const st = current;
            current = null;
            speaking = false;
            speechMs = silenceMs = 0;
            if (!st) return;
            const audio = utterance;
            utterance = [];
            events.onEndOfSpeech?.();
            let text = await finishStream(st);
            rewarm();
            if (!text && st.failed && !closed) text = await retry(audio);
            if (!closed) events.onTurn(text);
        };

        await warm.ready; // make sure the first socket is usable before accepting audio

        return {
            push(pcm) {
                const frameMs = pcm.length / BYTES_PER_MS;
                const level = rms(pcm);
                const threshold = Math.max(VAD_MIN_LEVEL, noiseFloor * VAD_SNR);
                const loud = level > threshold;
                // Track the room's noise floor only from non-speech frames (fast down, slow up).
                if (!speaking && !loud) {
                    noiseFloor = noiseFloor === 0
                        ? level
                        : noiseFloor + (level - noiseFloor) * (level < noiseFloor ? 0.2 : 0.02);
                }
                if (VAD_DEBUG && Date.now() - lastLog > 500) {
                    lastLog = Date.now();
                    console.log(`VAD level=${level.toFixed(0)} floor=${noiseFloor.toFixed(0)} thr=${threshold.toFixed(0)} speaking=${speaking}`);
                }

                if (!speaking) {
                    preroll.push(pcm);
                    prerollBytes += pcm.length;
                    while (prerollBytes > VAD_PREROLL_MS * BYTES_PER_MS && preroll.length > 1) {
                        prerollBytes -= preroll.shift()!.length;
                    }
                    // leaky accumulator: brief dips between syllables don't reset it
                    speechMs = loud ? speechMs + frameMs : Math.max(0, speechMs - frameMs / 2);
                    if (speechMs >= VAD_MIN_SPEECH_MS) {
                        speaking = true;
                        silenceMs = 0;
                        const st = take();
                        st.text = '';
                        current = st;
                        utterance = [];
                        // Live captions from Voxtral's deltas.
                        st.sock.on('message', () => st.text.trim() && events.onPartial(st.text.trim()));
                        send(st, Buffer.concat(preroll));
                        preroll.length = 0;
                        prerollBytes = 0;
                    }
                    return;
                }

                if (current) send(current, pcm);
                silenceMs = loud ? 0 : silenceMs + frameMs;
                if (silenceMs >= VAD_SILENCE_MS) void endOfSpeech();
            },
            close() {
                closed = true;
                current?.sock.close();
                warm?.sock.close();
            },
        };
    },
};

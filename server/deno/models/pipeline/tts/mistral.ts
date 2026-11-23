// Mistral Voxtral TTS. One streaming HTTP request per sentence, all issued eagerly; the
// audio is played back in sentence order.
import { Buffer } from 'node:buffer';
import { mistralApiKey, SAMPLE_RATE } from '../../../utils.ts';
import { AsyncQueue, env, sseJson, type TtsProvider, type TtsSession, type TtsUtterance } from '../types.ts';

const URL_ = 'https://api.mistral.ai/v1/audio/speech';
const MODEL = env('MISTRAL_TTS_MODEL') ?? 'voxtral-mini-tts-3';
const TTS_RATE = Number(env('MISTRAL_TTS_SAMPLE_RATE') ?? '24000');
// Voxtral TTS requires a voice; used when the character has none.
const DEFAULT_VOICE = env('MISTRAL_TTS_VOICE') ?? 'en_paul_neutral';

// Mono PCM16 linear-interpolation resampler.
const resample = (input: Buffer, from: number, to: number): Buffer => {
    if (from === to || input.length < 4) return input;
    const inSamples = input.length >> 1;
    const outSamples = Math.floor((inSamples * to) / from);
    const out = Buffer.alloc(outSamples * 2);
    for (let i = 0; i < outSamples; i++) {
        const pos = (i * from) / to;
        const l = Math.floor(pos);
        const r = Math.min(l + 1, inSamples - 1);
        const a = input.readInt16LE(l * 2);
        const b = input.readInt16LE(r * 2);
        out.writeInt16LE(Math.round(a + (b - a) * (pos - l)), i * 2);
    }
    return out;
};

// float32 LE -> int16 LE. `carry` holds bytes of a sample split across chunks.
const makeFloatToPcm16 = () => {
    let carry = Buffer.alloc(0);
    return (chunk: Buffer): Buffer => {
        const all = carry.length ? Buffer.concat([carry, chunk]) : chunk;
        const usable = all.length - (all.length % 4);
        carry = Buffer.from(all.subarray(usable));
        const out = Buffer.alloc(usable / 2);
        for (let i = 0; i < usable / 4; i++) {
            const f = Math.max(-1, Math.min(1, all.readFloatLE(i * 4)));
            out.writeInt16LE(Math.round(f * 32767), i * 2);
        }
        return out;
    };
};

// Voxtral rejects input that is empty after its own sanitization (e.g. emoji only).
const clean = (text: string) => text.replace(/[*_`#>~]/g, '').replace(/\s+/g, ' ').trim();

export const mistralTts: TtsProvider = {
    id: 'mistral',
    open(voice): Promise<TtsSession> {
        if (!mistralApiKey) return Promise.reject(new Error('MISTRAL_API_KEY is not set'));
        const headers = { Authorization: `Bearer ${mistralApiKey}`, 'Content-Type': 'application/json', Accept: 'text/event-stream' };
        const voiceId = voice || DEFAULT_VOICE;

        const synthesize = (text: string, signal: AbortSignal): AsyncQueue<Buffer> => {
            const q = new AsyncQueue<Buffer>();
            (async () => {
                try {
                    const res = await fetch(URL_, {
                        method: 'POST',
                        headers,
                        signal,
                        body: JSON.stringify({
                            model: MODEL,
                            input: text,
                            ...(voiceId ? { voice_id: voiceId } : {}),
                            response_format: 'pcm',
                            stream: true,
                        }),
                    });
                    if (!res.ok || !res.body) {
                        console.error('Mistral TTS failed:', res.status, await res.text().catch(() => ''));
                        return;
                    }
                    const toPcm16 = makeFloatToPcm16();
                    for await (const ev of sseJson(res.body)) {
                        if (ev.type === 'speech.audio.delta' && ev.audio_data) {
                            const pcm = resample(toPcm16(Buffer.from(ev.audio_data, 'base64')), TTS_RATE, SAMPLE_RATE);
                            if (pcm.length) q.push(pcm);
                        }
                    }
                } catch (err: any) {
                    if (err?.name !== 'AbortError') console.error('Mistral TTS error:', err);
                } finally {
                    q.end();
                }
            })();
            return q;
        };

        // Warm the HTTPS connection so the first sentence reuses it.
        fetch('https://api.mistral.ai/v1/models', { headers }).then((r) => r.body?.cancel()).catch(() => {});

        return Promise.resolve({
            utterance(): TtsUtterance {
                const abort = new AbortController();
                const playlist = new AsyncQueue<AsyncQueue<Buffer>>();
                return {
                    say(text) {
                        const t = clean(text);
                        if (t && !abort.signal.aborted) playlist.push(synthesize(t, abort.signal));
                    },
                    end() {
                        playlist.end();
                    },
                    cancel() {
                        abort.abort();
                        playlist.clear();
                        playlist.end();
                    },
                    audio: (async function* () {
                        for await (const sentence of playlist) {
                            for await (const pcm of sentence) {
                                if (abort.signal.aborted) return;
                                yield pcm;
                            }
                        }
                    })(),
                };
            },
            close() {},
        });
    },
};

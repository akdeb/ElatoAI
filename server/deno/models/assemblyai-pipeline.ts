import { Buffer } from 'node:buffer';
import type { RawData } from 'npm:@types/ws';
import { addConversation } from '../supabase.ts';
import {
    assemblyaiApiKey,
    assemblyaiLlmModel,
    assemblyaiSttModel,
    createOpusPacketizer,
    defaultAssemblyAIPipelineVoice,
    isDev,
    SAMPLE_RATE,
} from '../utils.ts';

// Streaming STT -> LLM Gateway -> streaming TTS, all on one AssemblyAI API key.
//
// Unlike the managed Voice Agent API (models/assemblyai.ts) this server owns the loop, so each
// stage can be tuned. Latency tricks:
//  - the STT and TTS sockets are opened when the call starts and stay open for every turn, so
//    no turn pays a handshake
//  - mic PCM goes straight to STT (16 kHz in, no resampling) and STT's own turn detection
//    decides when the user is done
//  - the LLM streams, and complete sentences (the first one at its first clause) go to TTS
//    with Generate + Flush while the rest of the reply is still being written
//  - TTS audio is 24 kHz PCM, so it goes to the Opus packetizer as is
//  - barge-in aborts the LLM request, sends TTS `Cancel`, and drops audio already queued

const REGION = (Deno.env.get('ASSEMBLYAI_REGION') ?? 'us').toLowerCase() === 'eu' ? 'eu' : 'us';
const STT_HOST = REGION === 'eu' ? 'streaming.eu.assemblyai.com' : 'streaming.assemblyai.com';
const TTS_HOST = `tts.${REGION}.assemblyai.com`;
const LLM_HOST = REGION === 'eu' ? 'llm-gateway.eu.assemblyai.com' : 'llm-gateway.assemblyai.com';

const MIC_RATE = 16000; // ESP32 mic stream
const TTS_RATE = SAMPLE_RATE; // 24 kHz, the rate the Opus packetizer expects
const BYTES_PER_MS = (TTS_RATE * 2) / 1000;
const STT_MIN_CHUNK_BYTES = (MIC_RATE * 2 * 50) / 1000; // STT wants >= 50 ms per frame

const MIN_TURN_SILENCE = Deno.env.get('ASSEMBLYAI_MIN_TURN_SILENCE') ?? '160';
const MAX_TURN_SILENCE = Deno.env.get('ASSEMBLYAI_MAX_TURN_SILENCE') ?? '400';
const LLM_MAX_TOKENS = Number(Deno.env.get('ASSEMBLYAI_LLM_MAX_TOKENS') ?? '300');
// Only sent when set: not every Gateway model accepts them.
const LLM_TEMPERATURE = Deno.env.get('ASSEMBLYAI_LLM_TEMPERATURE');
const LLM_REASONING_EFFORT = Deno.env.get('ASSEMBLYAI_LLM_REASONING_EFFORT');
// The ESP32 stops streaming its mic while the agent talks (no echo cancellation), so by default
// stray audio is dropped while replying. Set True if your hardware cancels echo and you want
// the user to be able to talk over the agent.
const BARGE_IN = Deno.env.get('ASSEMBLYAI_BARGE_IN') === 'True';
// TTS renders much faster than real time. Keep at most this much audio ahead of the playhead
// so the device's playback buffer is not overrun.
const PLAYBACK_LEAD_MS = Number(Deno.env.get('ASSEMBLYAI_PLAYBACK_LEAD_MS') ?? '800');
const MAX_HISTORY_MESSAGES = 24;
const CONNECT_TIMEOUT_MS = 10000;
const TTS_KEEPALIVE_MS = 60000;

const TOOLS = [{
    type: 'function',
    function: {
        name: 'end_session',
        description:
            'End the voice session immediately when the user says goodbye, bye, or says they need to leave.',
        parameters: {
            type: 'object',
            properties: { reason: { type: 'string', description: 'Brief reason for ending.' } },
        },
    },
}];

// A voice is a library slug such as `aai-kyla`. Accept a bare name (`kyla`) or a UUID too.
export const normalizePipelineVoice = (voice?: string | null) => {
    const v = (voice || defaultAssemblyAIPipelineVoice).trim().toLowerCase();
    if (v.startsWith('aai-') || /^[0-9a-f]{8}-[0-9a-f]{4}-/.test(v)) return v;
    return `aai-${v}`;
};

// Push/pull queue so the player drains TTS audio in order while it is still arriving.
class AsyncQueue<T> {
    private items: T[] = [];
    private waiter: (() => void) | null = null;
    private ended = false;
    push(item: T) {
        if (this.ended) return;
        this.items.push(item);
        this.wake();
    }
    end() {
        this.ended = true;
        this.wake();
    }
    private wake() {
        this.waiter?.();
        this.waiter = null;
    }
    async *[Symbol.asyncIterator]() {
        while (true) {
            if (this.items.length) {
                yield this.items.shift() as T;
            } else if (this.ended) {
                return;
            } else {
                await new Promise<void>((r) => (this.waiter = r));
            }
        }
    }
}

const NON_TERMINAL = /(?:\b(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr|St|vs|etc|e\.g|i\.e)|\b[A-Z]|\d)$/;

// Cuts streamed LLM text into speakable chunks: sentences, with the first chunk allowed to end
// at its first clause so audio starts sooner. Text after the last boundary is held back until
// its sentence completes, so a Flush never forces half a sentence out.
export class SentenceChunker {
    private buf = '';
    private first = true;
    push(text: string): string[] {
        this.buf += text;
        const out: string[] = [];
        while (true) {
            const cut = this.findCut();
            if (cut < 0) break;
            const chunk = this.buf.slice(0, cut).trim();
            this.buf = this.buf.slice(cut);
            if (chunk) {
                out.push(chunk);
                this.first = false;
            }
        }
        return out;
    }
    private findCut(): number {
        const re = this.first ? /[.!?,;:]["')\]”]*(\s)/g : /[.!?]["')\]”]*(\s)/g;
        const minLen = this.first ? 12 : 20;
        let m: RegExpExecArray | null;
        while ((m = re.exec(this.buf))) {
            const end = m.index + m[0].length; // just past the whitespace
            const before = this.buf.slice(0, m.index + 1);
            if (before.trim().length < minLen) continue;
            if (/[.]$/.test(before) && NON_TERMINAL.test(before.slice(0, -1))) continue;
            return end;
        }
        // No boundary in a very long run: cut at the last space rather than hold it forever.
        if (this.buf.length > 1500) {
            const sp = this.buf.lastIndexOf(' ', 1500);
            if (sp > 0) return sp + 1;
        }
        return -1;
    }
    flush(): string | null {
        const rest = this.buf.trim();
        this.buf = '';
        return rest || null;
    }
}

// Characters TTS should not read aloud (emoji, markdown). Applied per delta, so no trimming.
const cleanForTts = (text: string) =>
    text.replace(/\p{Extended_Pictographic}|️|‍/gu, '').replace(/[*_`#~]/g, '');

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

type Active = {
    audio: AsyncQueue<Buffer>;
    reply: string;
    generated: boolean; // any text sent to TTS
    flushesSent: number;
    flushesDone: number;
    llmDone: boolean;
    ttsFailed: boolean;
    committed: boolean; // reply already written to history
};

type TtsConn = {
    sock: WebSocket;
    ready: boolean;
    queue: string[]; // frames waiting for Begin
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
    const apiKey: string = assemblyaiApiKey;
    const clientWs = ws as any; // the device socket is an `ws` socket (event-emitter API)

    const voiceId = normalizePipelineVoice(user.personality?.oai_voice);
    const opus = createOpusPacketizer((packet) => ws.send(packet));

    const history: Array<Record<string, unknown>> = [{ role: 'system', content: systemPrompt }];
    const trimHistory = () => {
        if (history.length > MAX_HISTORY_MESSAGES + 1) {
            history.splice(1, history.length - MAX_HISTORY_MESSAGES - 1);
            // never start on an orphaned assistant message
            while (history.length > 1 && history[1].role !== 'user') history.splice(1, 1);
        }
    };

    let closed = false;
    let responding = false;
    let sessionEnding = false;
    let createdSent = false;
    let turnAbort: AbortController | null = null;
    let active: Active | null = null;

    const sendDevice = (msg: string, extra: Record<string, unknown> = {}) => {
        if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'server', msg, ...extra }));
    };
    const ensureResponseStarted = () => {
        if (createdSent) return;
        createdSent = true;
        sendDevice('RESPONSE.CREATED', { volume_control: user.device?.volume ?? 100 });
    };

    // ---- TTS: one session for the whole call -----------------------------------
    let tts: TtsConn | null = null;
    let pendingCancels = 0; // Cancel frames not yet answered; audio before `Cancelled` is stale
    let ttsKeepAlive: ReturnType<typeof setInterval> | undefined;

    const ttsUrl = `wss://${TTS_HOST}/v1/ws?` + new URLSearchParams({
        voice_id: voiceId,
        sample_rate: String(TTS_RATE),
        encoding: 'pcm_s16le',
        word_boundaries: 'false',
    });

    const openTts = (): TtsConn => {
        const sock = new WebSocket(ttsUrl, {
            headers: { Authorization: apiKey },
        } as any);
        const conn: TtsConn = { sock, ready: false, queue: [] };
        pendingCancels = 0;

        sock.addEventListener('message', (ev) => {
            if (typeof ev.data !== 'string') return;
            let msg: any;
            try {
                msg = JSON.parse(ev.data);
            } catch {
                return;
            }
            switch (msg.type) {
                case 'Begin':
                    conn.ready = true;
                    for (const frame of conn.queue) sock.send(frame);
                    conn.queue = [];
                    break;
                case 'Audio': {
                    const a = active;
                    if (pendingCancels > 0 || !a || typeof msg.audio !== 'string') break;
                    a.audio.push(Buffer.from(msg.audio, 'base64'));
                    break;
                }
                case 'FlushDone': {
                    const a = active;
                    if (pendingCancels > 0 || !a) break;
                    a.flushesDone++;
                    maybeFinish(a);
                    break;
                }
                case 'Cancelled':
                    pendingCancels = Math.max(0, pendingCancels - 1);
                    break;
                case 'Error':
                    console.error('AssemblyAI TTS error:', msg);
                    break;
            }
        });
        sock.addEventListener('close', () => {
            if (tts === conn) tts = null;
            const a = active;
            if (a && !a.committed) {
                a.ttsFailed = true;
                maybeFinish(a);
            }
        });
        sock.addEventListener('error', () => {});
        return conn;
    };

    const getTts = (): TtsConn => {
        if (tts && tts.sock.readyState <= WebSocket.OPEN) return tts;
        tts = openTts();
        return tts;
    };

    const ttsSend = (frame: Record<string, unknown>) => {
        const conn = getTts();
        const data = JSON.stringify(frame);
        if (conn.ready && conn.sock.readyState === WebSocket.OPEN) conn.sock.send(data);
        else conn.queue.push(data);
    };

    const maybeFinish = (a: Active) => {
        if (a.llmDone && (a.flushesDone >= a.flushesSent || a.ttsFailed)) a.audio.end();
    };

    // ---- turn lifecycle ---------------------------------------------------------
    // Stop whatever is being said. `notifyDevice` tells the device to go back to listening.
    const interrupt = (notifyDevice: boolean) => {
        const a = active;
        turnAbort?.abort();
        turnAbort = null;
        if (a) {
            active = null;
            if (!a.committed) {
                a.committed = true;
                // Keep what the model had said so far so the next turn has context.
                if (a.reply.trim()) history.push({ role: 'assistant', content: a.reply });
            }
            if (a.generated && tts) {
                if (tts.ready) {
                    pendingCancels++;
                    tts.sock.send(JSON.stringify({ type: 'Cancel' }));
                } else {
                    tts.queue = []; // never sent, nothing to cancel
                }
            }
            a.audio.end();
        }
        opus.reset();
        createdSent = false;
        responding = false;
        if (notifyDevice) sendDevice('RESPONSE.COMPLETE');
    };

    const runTurn = async (userText: string, persistUser: boolean, t0: number) => {
        interrupt(false);
        const abort = new AbortController();
        turnAbort = abort;
        const { signal } = abort;

        const a: Active = {
            audio: new AsyncQueue<Buffer>(),
            reply: '',
            generated: false,
            flushesSent: 0,
            flushesDone: 0,
            llmDone: false,
            ttsFailed: false,
            committed: false,
        };
        active = a;
        responding = true;

        history.push({ role: 'user', content: userText });
        trimHistory();
        if (persistUser) addConversation(supabase, 'user', userText, user).catch(() => {});

        getTts(); // make sure the TTS session is open or opening

        let firstTokenAt = 0;
        let firstAudioAt = 0;

        // Plays TTS audio to the device at roughly real-time pace.
        const player = (async () => {
            let sentMs = 0;
            let startedAt = 0;
            for await (const pcm of a.audio) {
                if (active !== a) return;
                if (!startedAt) {
                    startedAt = Date.now();
                    firstAudioAt = startedAt;
                    ensureResponseStarted();
                }
                const ahead = sentMs - (Date.now() - startedAt);
                if (ahead > PLAYBACK_LEAD_MS) {
                    await sleep(ahead - PLAYBACK_LEAD_MS);
                    if (active !== a) return;
                }
                opus.push(pcm);
                sentMs += pcm.length / BYTES_PER_MS;
            }
        })();

        const speak = (text: string) => {
            if (signal.aborted || !/[\p{L}\p{N}]/u.test(text)) return;
            // Join sentences with a space: consecutive Generate frames are concatenated as is.
            ttsSend({ type: 'Generate', text: text + ' ' });
            ttsSend({ type: 'Flush' });
            a.generated = true;
            a.flushesSent++;
        };

        const toolCalls = new Map<number, { name: string; args: string }>();
        try {
            const res = await fetch(`https://${LLM_HOST}/v1/chat/completions`, {
                method: 'POST',
                headers: {
                    Authorization: apiKey,
                    'Content-Type': 'application/json',
                    Accept: 'text/event-stream',
                },
                signal,
                body: JSON.stringify({
                    model: assemblyaiLlmModel,
                    messages: history,
                    tools: TOOLS,
                    stream: true,
                    max_tokens: LLM_MAX_TOKENS,
                    ...(LLM_TEMPERATURE ? { temperature: Number(LLM_TEMPERATURE) } : {}),
                    ...(LLM_REASONING_EFFORT ? { reasoning_effort: LLM_REASONING_EFFORT } : {}),
                }),
            });
            if (!res.ok || !res.body) {
                throw new Error(
                    `LLM Gateway failed: ${res.status} ${await res.text().catch(() => '')}`,
                );
            }

            const chunker = new SentenceChunker();
            const decoder = new TextDecoder();
            let pending = '';
            for await (const part of res.body as any) {
                pending += decoder.decode(part, { stream: true });
                let nl: number;
                while ((nl = pending.indexOf('\n')) >= 0) {
                    const line = pending.slice(0, nl).trim();
                    pending = pending.slice(nl + 1);
                    if (!line.startsWith('data:') || line.includes('[DONE]')) continue;
                    let delta: any;
                    try {
                        delta = JSON.parse(line.slice(5)).choices?.[0]?.delta;
                    } catch {
                        continue;
                    }
                    if (!delta) continue;
                    const content = typeof delta.content === 'string' ? delta.content : '';
                    if (content) {
                        if (!firstTokenAt) firstTokenAt = Date.now();
                        a.reply += content;
                        chunker.push(cleanForTts(content)).forEach(speak);
                    }
                    for (const tc of delta.tool_calls ?? []) {
                        const cur = toolCalls.get(tc.index ?? 0) ?? { name: '', args: '' };
                        cur.name = tc.function?.name ?? cur.name;
                        cur.args += tc.function?.arguments ?? '';
                        toolCalls.set(tc.index ?? 0, cur);
                    }
                }
            }
            const rest = chunker.flush();
            if (rest) speak(rest);
        } catch (err: any) {
            if (err?.name !== 'AbortError' && !signal.aborted) {
                console.error('AssemblyAI LLM Gateway error:', err);
                if (active === a) {
                    interrupt(false);
                    sendDevice('RESPONSE.ERROR');
                }
                return;
            }
        }
        if (signal.aborted) return; // barge-in already cleaned up

        a.llmDone = true;
        maybeFinish(a);
        await player;
        if (active !== a) return;

        if (a.reply.trim() && !a.committed) {
            a.committed = true;
            history.push({ role: 'assistant', content: a.reply });
            addConversation(supabase, 'assistant', a.reply, user).catch(() => {});
        }
        if ([...toolCalls.values()].some((t) => t.name === 'end_session')) sessionEnding = true;

        if (firstAudioAt) {
            console.log(
                `[assemblyai-pipeline] end_of_turn->llm_first_token=${
                    firstTokenAt ? firstTokenAt - t0 : -1
                }ms end_of_turn->first_audio=${firstAudioAt - t0}ms`,
            );
        }

        opus.flush(true);
        active = null;
        turnAbort = null;
        responding = false;
        createdSent = false;
        sendDevice('RESPONSE.COMPLETE');
        if (sessionEnding) sendDevice('SESSION.END');
    };

    // ---- STT: one session for the whole call ------------------------------------
    let stt: WebSocket | null = null;
    let sttReady = false;
    let lastTurnOrder = -1;
    let micBuf: Buffer = Buffer.alloc(0);
    let sttRetries = 0;

    const sttUrl = `wss://${STT_HOST}/v3/ws?` + new URLSearchParams({
        speech_model: assemblyaiSttModel,
        sample_rate: String(MIC_RATE),
        min_turn_silence: MIN_TURN_SILENCE,
        max_turn_silence: MAX_TURN_SILENCE,
    });

    const onTurn = (msg: any) => {
        const text = typeof msg.transcript === 'string' ? msg.transcript.trim() : '';
        if (!msg.end_of_turn) {
            // Only reached with BARGE_IN: mic audio is dropped while replying otherwise.
            if (BARGE_IN && responding && text.split(/\s+/).length >= 2) interrupt(false);
            return;
        }
        if (!/[\p{L}\p{N}]/u.test(text)) return;
        if (typeof msg.turn_order === 'number') {
            if (msg.turn_order <= lastTurnOrder) return; // already handled this turn
            lastTurnOrder = msg.turn_order;
        }
        sendDevice('AUDIO.COMMITTED');
        void runTurn(text, true, Date.now());
    };

    const openStt = (): Promise<void> => {
        const sock = new WebSocket(sttUrl, {
            headers: { Authorization: apiKey },
        } as any);
        sock.binaryType = 'arraybuffer';
        stt = sock;
        sttReady = false;
        return new Promise<void>((resolve, reject) => {
            sock.addEventListener('message', (ev) => {
                if (typeof ev.data !== 'string') return;
                let msg: any;
                try {
                    msg = JSON.parse(ev.data);
                } catch {
                    return;
                }
                if (msg.type === 'Begin') {
                    sttReady = true;
                    sttRetries = 0;
                    resolve();
                } else if (msg.type === 'Turn') {
                    onTurn(msg);
                } else if (msg.error || msg.type === 'Error') {
                    console.error('AssemblyAI STT error:', msg);
                }
            });
            sock.addEventListener('error', () => reject(new Error('STT socket error')));
            sock.addEventListener('close', (ev) => {
                sttReady = false;
                reject(new Error(`STT closed (${ev.code})`));
                if (stt !== sock || closed) return;
                // Session limit or a network blip: reconnect so the call keeps going.
                if (sttRetries++ < 5) {
                    console.warn(`AssemblyAI STT closed (${ev.code} ${ev.reason}), reconnecting`);
                    setTimeout(() => !closed && openStt().catch(() => {}), 500 * sttRetries);
                }
            });
        });
    };

    const onMic = (pcm: Buffer) => {
        if (!sttReady || !stt || stt.readyState !== WebSocket.OPEN) return;
        if (responding && !BARGE_IN) return;
        micBuf = micBuf.length ? Buffer.concat([micBuf, pcm]) : pcm;
        if (micBuf.length >= STT_MIN_CHUNK_BYTES) {
            stt.send(micBuf);
            micBuf = Buffer.alloc(0);
        }
    };

    // ---- device socket ----------------------------------------------------------
    const withTimeout = <T>(p: Promise<T>, label: string) =>
        Promise.race([
            p,
            new Promise<T>((_, rej) =>
                setTimeout(() => rej(new Error(`${label} connection timeout`)), CONNECT_TIMEOUT_MS)
            ),
        ]);

    clientWs.on('message', async (data: RawData, isBinary: boolean) => {
        if (isBinary) {
            const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer);
            if (isDev && connectionPcmFile) await connectionPcmFile.write(buffer);
            onMic(buffer);
            return;
        }
        let message: any;
        try {
            message = JSON.parse(Buffer.from(data as any).toString('utf-8'));
        } catch {
            return;
        }
        if (message?.type !== 'instruction') return;

        // STT owns turn-taking, so end_of_speech is ignored.
        if (message.msg === 'INTERRUPT') {
            interrupt(true);
        } else if (message.msg === 'END_SESSION') {
            sendDevice('SESSION.END');
            setTimeout(() => ws.close(), 500);
        }
    });

    clientWs.on('error', (error: any) => console.error('ESP32 WebSocket error:', error));

    clientWs.on('close', async (code: number, reason: string) => {
        console.log(`ESP32 WebSocket closed with code ${code}, reason: ${reason}`);
        closed = true;
        turnAbort?.abort();
        clearInterval(ttsKeepAlive);
        // Terminate first so the sessions are billed only for the call.
        if (stt?.readyState === WebSocket.OPEN) stt.send(JSON.stringify({ type: 'Terminate' }));
        if (tts?.sock.readyState === WebSocket.OPEN) {
            tts.sock.send(JSON.stringify({ type: 'Terminate' }));
        }
        const s = stt, t = tts?.sock;
        setTimeout(() => {
            s?.close();
            t?.close();
        }, 500);
        await closeHandler();
        opus.close();
        if (isDev && connectionPcmFile) connectionPcmFile.close();
    });

    // Open both sessions before accepting audio so the first turn never waits on a handshake.
    const ttsConn = getTts();
    await withTimeout(openStt(), 'AssemblyAI STT');
    await withTimeout(
        new Promise<void>((resolve, reject) => {
            if (ttsConn.ready) return resolve();
            const poll = setInterval(() => {
                if (ttsConn.ready) {
                    clearInterval(poll);
                    resolve();
                } else if (ttsConn.sock.readyState > WebSocket.OPEN) {
                    clearInterval(poll);
                    reject(new Error('TTS closed before Begin'));
                }
            }, 20);
        }),
        'AssemblyAI TTS',
    );

    // Idle TTS sessions close after two minutes; the agent can be quiet for longer.
    ttsKeepAlive = setInterval(() => {
        if (tts?.ready && tts.sock.readyState === WebSocket.OPEN && !responding) {
            tts.sock.send(JSON.stringify({ type: 'KeepAlive' }));
        }
    }, TTS_KEEPALIVE_MS);

    // The agent speaks first: the model composes the greeting from the first-message prompt.
    void runTurn(
        'Begin this call now, in character. Follow these first-message instructions; ' +
            'do not read or describe the instructions aloud:\n' +
            (firstMessage.trim() || 'Greet the user briefly.'),
        false,
        Date.now(),
    );
};

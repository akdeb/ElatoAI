// The shared turn loop for every STT -> LLM -> TTS combination.
//
//   mic (16 kHz) -> STT (owns turn detection) -> LLM (streams, may call tools)
//     -> sentences -> TTS (24 kHz PCM) -> Opus -> device
//
// Latency tricks:
//  - STT and TTS sessions open when the call starts and stay open, so no turn pays a handshake
//  - the LLM streams, and complete sentences (the first one at its first clause) go to TTS
//    while the rest of the reply is still being written
//  - barge-in aborts the LLM request, cancels TTS, and drops audio already queued
import { Buffer } from 'node:buffer';
import type { RawData } from 'npm:@types/ws';
import { addConversation } from '../../supabase.ts';
import { createOpusPacketizer, isDev, SAMPLE_RATE } from '../../utils.ts';
import { createPlant, PLANT_MODE } from './tools/plant.ts';
import { env, type LlmProvider, type SttProvider, type SttSession, type ToolSpec, type TtsProvider, type TtsSession, type TtsUtterance } from './types.ts';

const BYTES_PER_MS = (SAMPLE_RATE * 2) / 1000;
// The ESP32 stops streaming its mic while the agent talks (no echo cancellation), so by default
// stray audio is dropped while replying. Set True if your hardware cancels echo.
const BARGE_IN = env('PIPELINE_BARGE_IN', 'ASSEMBLYAI_BARGE_IN') === 'True';
// TTS renders much faster than real time. Keep at most this much audio ahead of the playhead
// so the device's playback buffer is not overrun.
const PLAYBACK_LEAD_MS = Number(env('PIPELINE_PLAYBACK_LEAD_MS', 'ASSEMBLYAI_PLAYBACK_LEAD_MS') ?? '800');
// Pipeline TTS is clean studio audio: don't squeeze it through the 24 kbps "voip" default.
const OPUS_BITRATE = Number(env('PIPELINE_OPUS_BITRATE', 'ASSEMBLYAI_OPUS_BITRATE') ?? '48000');
const MAX_HISTORY_MESSAGES = 24;
const MAX_TOOL_ROUNDS = 3;
const CONNECT_TIMEOUT_MS = 10000;
const TTS_KEEPALIVE_MS = 60000;

const END_SESSION_TOOL: ToolSpec = {
    type: 'function',
    function: {
        name: 'end_session',
        description: 'End the voice session immediately when the user says goodbye, bye, or says they need to leave.',
        parameters: {
            type: 'object',
            properties: { reason: { type: 'string', description: 'Brief reason for ending.' } },
        },
    },
};

const NON_TERMINAL = /(?:\b(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr|St|vs|etc|e\.g|i\.e)|\b[A-Z]|\d)$/;

// Cuts streamed LLM text into speakable chunks: sentences, with the first chunk allowed to end
// at its first clause so audio starts sooner. Text after the last boundary is held back until
// its sentence completes, so a Flush never forces half a sentence out.
class SentenceChunker {
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
// Asterisks stay until a whole chunk is cut, so *stage directions* can be dropped as a pair.
const cleanForTts = (text: string) => text.replace(/\p{Extended_Pictographic}|️|‍/gu, '').replace(/[_`#~]/g, '');
// Stage directions (*sighs*, (laughs)) are not speakable: drop them entirely.
const dropStageDirections = (text: string) =>
    text.replace(/\*[^*]*\*/g, ' ').replace(/\([^)]*\)/g, ' ').replace(/\*/g, '').replace(/\s+/g, ' ').trim();

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const withTimeout = <T>(p: Promise<T>, label: string): Promise<T> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<T>((_, rej) => {
        timer = setTimeout(() => rej(new Error(`${label} connection timeout`)), CONNECT_TIMEOUT_MS);
    });
    return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
};

export type PipelineConfig = {
    stt: SttProvider;
    llm: LlmProvider;
    tts: TtsProvider;
    voice: string | null;
};

type Turn = {
    utter: TtsUtterance;
    reply: string; // everything said this turn (all tool rounds)
    roundReply: string; // the current LLM round only
    committed: boolean; // written to history
    isEvent: boolean;
};

export const runPipeline = async (
    { ws, payload, connectionPcmFile, firstMessage, systemPrompt, closeHandler }: ProviderArgs,
    cfg: PipelineConfig,
) => {
    const { user, supabase } = payload;
    const clientWs = ws as any; // the device socket is an `ws` socket (event-emitter API)
    const tag = `[pipeline ${cfg.stt.id}>${cfg.llm.id}:${cfg.llm.model}>${cfg.tts.id}]`;
    console.log(`${tag} starting`);

    const opus = createOpusPacketizer((packet) => ws.send(packet), { bitrate: OPUS_BITRATE, application: 'audio' });

    let closed = false;
    let responding = false;
    let sessionEnding = false;
    let createdSent = false;
    let started = false; // proactive events wait for the greeting
    let turnAbort: AbortController | null = null;
    let active: Turn | null = null;
    let lastActivityAt = Date.now(); // last time anyone spoke
    let lastPartialAt = 0; // user is mid-sentence if recent
    let pendingEvent: string | null = null;

    const sendDevice = (msg: string, extra: Record<string, unknown> = {}) => {
        if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'server', msg, ...extra }));
    };
    const ensureResponseStarted = () => {
        if (createdSent) return;
        createdSent = true;
        sendDevice('RESPONSE.CREATED', { volume_control: user.device?.volume ?? 100 });
    };
    // Live captions for devices with a screen (the plant demo).
    const caption = (who: 'user' | 'agent', text: string, final = true) => {
        if (PLANT_MODE) sendDevice(who === 'user' ? 'TRANSCRIPT.USER' : 'TRANSCRIPT.AGENT', { text, final });
    };

    // ---- tools ----------------------------------------------------------------------
    const plant = PLANT_MODE
        ? createPlant({ sendDevice, raiseEvent: (text, urgent) => queueEvent(text, urgent) })
        : null;
    const tools: ToolSpec[] = [...(plant?.tools ?? []), END_SESSION_TOOL];
    const runTool = (name: string, args: any): string => {
        const r = plant?.runTool(name, args);
        if (r !== undefined) return r;
        if (name === 'end_session') return JSON.stringify({ ok: true });
        return JSON.stringify({ error: `unknown tool ${name}` });
    };

    // ---- history --------------------------------------------------------------------
    const history: Array<Record<string, unknown>> = [{
        role: 'system',
        content: plant ? systemPrompt + plant.prompt : systemPrompt,
    }];
    const trimHistory = () => {
        if (history.length > MAX_HISTORY_MESSAGES + 1) {
            history.splice(1, history.length - MAX_HISTORY_MESSAGES - 1);
            // never start on an orphaned assistant or tool message
            while (history.length > 1 && history[1].role !== 'user') history.splice(1, 1);
        }
    };

    // ---- sessions ---------------------------------------------------------------------
    let stt: SttSession | null = null;
    let tts: TtsSession | null = null;

    // ---- proactive events (sensor reactions) ------------------------------------------
    // An urgent event interrupts what is being said; others wait until it is quiet and the
    // person is not mid-sentence.
    const queueEvent = (text: string, urgent: boolean) => {
        if (urgent && responding && !active?.isEvent) interrupt(false);
        pendingEvent = text;
        fireEvent();
    };
    const fireEvent = () => {
        if (!started || !pendingEvent || responding || closed) return;
        if (Date.now() - lastPartialAt < 1200) return;
        const text = pendingEvent;
        pendingEvent = null;
        void runTurn(text, false, Date.now(), true);
    };

    // ---- turn lifecycle ---------------------------------------------------------------
    // Stop whatever is being said. `notifyDevice` tells the device to go back to listening.
    const interrupt = (notifyDevice: boolean) => {
        const t = active;
        turnAbort?.abort();
        turnAbort = null;
        if (t) {
            active = null;
            if (!t.committed) {
                t.committed = true;
                // Keep what was said so far so the next turn has context.
                if (t.roundReply.trim()) history.push({ role: 'assistant', content: t.roundReply });
            }
            t.utter.cancel();
        }
        opus.reset();
        createdSent = false;
        responding = false;
        if (notifyDevice) sendDevice('RESPONSE.COMPLETE');
    };

    const runTurn = async (userText: string, persistUser: boolean, t0: number, isEvent = false) => {
        interrupt(false);
        if (!tts) return;
        const abort = new AbortController();
        turnAbort = abort;
        const { signal } = abort;

        const t: Turn = { utter: tts.utterance(), reply: '', roundReply: '', committed: false, isEvent };
        active = t;
        responding = true;
        lastActivityAt = Date.now();

        history.push({ role: 'user', content: userText });
        trimHistory();
        if (persistUser) addConversation(supabase, 'user', userText, user).catch(() => {});

        let firstTokenAt = 0;
        let firstAudioAt = 0;

        // Plays TTS audio to the device at roughly real-time pace.
        const player = (async () => {
            let sentMs = 0;
            let startedAt = 0;
            for await (const pcm of t.utter.audio) {
                if (active !== t) return;
                if (!startedAt) {
                    startedAt = Date.now();
                    firstAudioAt = startedAt;
                    ensureResponseStarted();
                }
                const ahead = sentMs - (Date.now() - startedAt);
                if (ahead > PLAYBACK_LEAD_MS) {
                    await sleep(ahead - PLAYBACK_LEAD_MS);
                    if (active !== t) return;
                }
                opus.push(pcm);
                sentMs += pcm.length / BYTES_PER_MS;
            }
        })();

        const speak = (raw: string) => {
            const text = dropStageDirections(raw);
            if (signal.aborted || !/[\p{L}\p{N}]/u.test(text)) return;
            t.utter.say(text);
            caption('agent', text);
        };

        // Each round streams one completion. A round that asks for tools gets their results
        // appended and runs again, so the model can read a sensor and then talk about it.
        let endSession = false;
        try {
            for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
                const calls = new Map<number, { id: string; name: string; args: string }>();
                const chunker = new SentenceChunker();
                t.roundReply = '';
                for await (const d of cfg.llm.stream({ messages: history, tools, signal })) {
                    if (d.content) {
                        if (!firstTokenAt) firstTokenAt = Date.now();
                        t.reply += d.content;
                        t.roundReply += d.content;
                        chunker.push(cleanForTts(d.content)).forEach(speak);
                    }
                    for (const tc of d.toolCalls ?? []) {
                        const cur = calls.get(tc.index) ?? { id: '', name: '', args: '' };
                        cur.id = tc.id ?? cur.id;
                        cur.name = tc.name ?? cur.name;
                        cur.args += tc.args ?? '';
                        calls.set(tc.index, cur);
                    }
                }
                const rest = chunker.flush();
                if (rest) speak(rest);

                const list = [...calls.values()].filter((c) => c.name);
                if (!list.length || signal.aborted) break;
                if (list.some((c) => c.name === 'end_session')) {
                    endSession = true;
                    break;
                }
                list.forEach((c, i) => (c.id ||= `call_${Date.now()}_${i}`));
                history.push({
                    role: 'assistant',
                    content: t.roundReply || null,
                    tool_calls: list.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: c.args || '{}' } })),
                });
                for (const c of list) {
                    let args: any = {};
                    try {
                        args = c.args ? JSON.parse(c.args) : {};
                    } catch { /* model sent bad JSON; the tool falls back to defaults */ }
                    const result = runTool(c.name, args);
                    console.log(`${tag} tool ${c.name}(${c.args || ''}) -> ${result}`);
                    history.push({ role: 'tool', tool_call_id: c.id, content: result });
                }
                t.roundReply = '';
            }
        } catch (err: any) {
            if (err?.name !== 'AbortError' && !signal.aborted) {
                console.error(`${tag} LLM error:`, err);
                if (active === t) {
                    interrupt(false);
                    sendDevice('RESPONSE.ERROR');
                }
                return;
            }
        }
        if (signal.aborted) return; // barge-in already cleaned up

        t.utter.end();
        await player;
        if (active !== t) return;

        if (!t.committed) {
            t.committed = true;
            if (t.roundReply.trim()) history.push({ role: 'assistant', content: t.roundReply });
            if (t.reply.trim()) addConversation(supabase, 'assistant', t.reply, user).catch(() => {});
        }
        if (endSession) sessionEnding = true;
        if (firstAudioAt) {
            console.log(`${tag} end_of_turn->llm_first_token=${firstTokenAt ? firstTokenAt - t0 : -1}ms end_of_turn->first_audio=${firstAudioAt - t0}ms`);
        }

        opus.flush(true);
        active = null;
        turnAbort = null;
        responding = false;
        createdSent = false;
        lastActivityAt = Date.now();
        sendDevice('RESPONSE.COMPLETE');
        if (sessionEnding) sendDevice('SESSION.END');
        else fireEvent();
    };

    // ---- STT events -------------------------------------------------------------------
    const sttEvents = {
        onPartial(text: string) {
            if (responding && !BARGE_IN) return;
            lastPartialAt = lastActivityAt = Date.now();
            caption('user', text, false);
            // Only reached with BARGE_IN: talking over the agent stops it.
            if (BARGE_IN && responding && text.split(/\s+/).length >= 2) interrupt(false);
        },
        onEndOfSpeech() {
            sendDevice('AUDIO.COMMITTED');
        },
        onTurn(text: string) {
            if (closed) return;
            if (!/[\p{L}\p{N}]/u.test(text)) {
                // Nothing intelligible: hand the device back to listening.
                if (!responding) sendDevice('RESPONSE.COMPLETE');
                return;
            }
            caption('user', text, true);
            sendDevice('AUDIO.COMMITTED');
            void runTurn(text, true, Date.now());
        },
    };

    // ---- device socket ----------------------------------------------------------------
    clientWs.on('message', async (data: RawData, isBinary: boolean) => {
        if (isBinary) {
            const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer);
            if (isDev && connectionPcmFile) await connectionPcmFile.write(buffer);
            if (responding && !BARGE_IN) return;
            stt?.push(buffer);
            return;
        }
        let message: any;
        try {
            message = JSON.parse(Buffer.from(data as any).toString('utf-8'));
        } catch {
            return;
        }
        if (message?.type === 'sensor') {
            plant?.onSensor(message);
            return;
        }
        if (message?.type !== 'instruction') return;
        // STT owns turn-taking, so end_of_speech from the device is ignored.
        if (message.msg === 'INTERRUPT') {
            interrupt(true);
        } else if (message.msg === 'END_SESSION') {
            sendDevice('SESSION.END');
            setTimeout(() => ws.close(), 500);
        }
    });

    clientWs.on('error', (error: any) => console.error('ESP32 WebSocket error:', error));

    let timer: ReturnType<typeof setInterval> | undefined;
    let keepAlive: ReturnType<typeof setInterval> | undefined;
    clientWs.on('close', async (code: number, reason: string) => {
        console.log(`ESP32 WebSocket closed with code ${code}, reason: ${reason}`);
        closed = true;
        turnAbort?.abort();
        clearInterval(timer);
        clearInterval(keepAlive);
        stt?.close();
        tts?.close();
        await closeHandler();
        opus.close();
        if (isDev && connectionPcmFile) connectionPcmFile.close();
    });

    // Open both sessions before accepting audio so the first turn never waits on a handshake.
    try {
        [stt, tts] = await Promise.all([
            withTimeout(cfg.stt.open(sttEvents), `${cfg.stt.id} STT`),
            withTimeout(cfg.tts.open(cfg.voice), `${cfg.tts.id} TTS`),
        ]);
    } catch (err) {
        // One device failing to reach a provider must not take the whole server down.
        console.error(`${tag} could not start session:`, err);
        sendDevice('RESPONSE.ERROR');
        ws.close();
        return;
    }
    if (closed) {
        stt.close();
        tts.close();
        return;
    }

    keepAlive = setInterval(() => !responding && tts?.keepAlive?.(), TTS_KEEPALIVE_MS);
    // Deferred events (the person was mid-sentence) and idle nudges.
    timer = setInterval(() => {
        fireEvent();
        if (!responding && !pendingEvent) plant?.tick(Date.now() - lastActivityAt);
    }, 500);

    const greetingNote = plant ? await plant.greetingNote() : '';
    started = true;
    // The character speaks first: the model composes the greeting from the first-message prompt.
    void runTurn(
        'Begin this call now, in character. Follow these first-message instructions; ' +
            'do not read or describe the instructions aloud:\n' +
            (firstMessage.trim() || 'Greet the user briefly.') + greetingNote,
        false,
        Date.now(),
    );
};

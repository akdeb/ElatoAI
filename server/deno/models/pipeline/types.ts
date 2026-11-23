// The three swappable stages of a voice pipeline. `runner.ts` owns the turn loop and the
// device; each stage only talks to its own service. Any STT works with any LLM and any TTS.
import type { Buffer } from 'node:buffer';

export const MIC_RATE = 16000; // ESP32 mic stream: 16 kHz PCM16 mono
// TTS plug-ins must emit 24 kHz PCM16 mono (the Opus packetizer's rate, SAMPLE_RATE in utils).

// ---- speech-to-text ------------------------------------------------------------------
export type SttEvents = {
    // Live transcript of the turn so far (for captions). Cumulative, not a delta.
    onPartial(text: string): void;
    // The user finished a turn. `text` may be '' if nothing intelligible was said.
    onTurn(text: string): void;
    // Optional: speech has ended and transcription is being finalized.
    onEndOfSpeech?(): void;
};

export interface SttSession {
    push(pcm16k: Buffer): void; // mic audio, MIC_RATE
    close(): void;
}

export type SttProvider = {
    id: string;
    open(events: SttEvents): Promise<SttSession>; // resolves once ready for audio
};

// ---- LLM -----------------------------------------------------------------------------
export type ChatMessage = Record<string, unknown>; // OpenAI chat format
export type ToolSpec = Record<string, unknown>; // OpenAI tool format

export type LlmDelta = {
    content?: string;
    toolCalls?: Array<{ index: number; id?: string; name?: string; args?: string }>;
};

export type LlmProvider = {
    id: string;
    model: string;
    stream(req: { messages: ChatMessage[]; tools: ToolSpec[]; signal: AbortSignal }): AsyncIterable<LlmDelta>;
};

// ---- text-to-speech ------------------------------------------------------------------
// One utterance = one spoken reply. Text is fed in sentence by sentence while the LLM is
// still writing; audio comes out in order.
export interface TtsUtterance {
    say(text: string): void;
    end(): void; // no more text; `audio` finishes once everything is rendered
    cancel(): void; // barge-in: stop rendering, drop queued audio
    audio: AsyncIterable<Buffer>; // 24 kHz PCM16 mono
}

export interface TtsSession {
    utterance(): TtsUtterance;
    keepAlive?(): void;
    close(): void;
}

export type TtsProvider = {
    id: string;
    open(voice: string | null): Promise<TtsSession>;
};

// ---- shared helpers ------------------------------------------------------------------
// Push/pull queue: a producer pushes while a consumer drains in order.
export class AsyncQueue<T> {
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
    clear() {
        this.items = [];
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

// Reads an SSE body line by line, yielding the JSON of each `data:` line.
export async function* sseJson(body: ReadableStream<Uint8Array>): AsyncIterable<any> {
    const decoder = new TextDecoder();
    let pending = '';
    for await (const part of body as any) {
        pending += decoder.decode(part, { stream: true });
        let nl: number;
        while ((nl = pending.indexOf('\n')) >= 0) {
            const line = pending.slice(0, nl).trim();
            pending = pending.slice(nl + 1);
            if (!line.startsWith('data:') || line.includes('[DONE]')) continue;
            try {
                yield JSON.parse(line.slice(5));
            } catch { /* keep-alive or partial line */ }
        }
    }
}

export const env = (...names: string[]): string | undefined => {
    for (const n of names) {
        const v = Deno.env.get(n);
        if (v !== undefined && v !== '') return v;
    }
    return undefined;
};

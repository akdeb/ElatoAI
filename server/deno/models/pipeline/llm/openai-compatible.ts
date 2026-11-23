// Any OpenAI-compatible streaming chat endpoint. AssemblyAI's LLM Gateway (Claude, GPT,
// Gemini, Gemma, ...) and Mistral both speak this format.
import { assemblyaiApiKey, assemblyaiLlmModel, mistralApiKey } from '../../../utils.ts';
import { env, type LlmProvider, sseJson } from '../types.ts';

type Endpoint = {
    id: string;
    url: string;
    headers: () => Record<string, string>;
    defaultModel: string;
    extra: () => Record<string, unknown>; // provider-specific body fields
};

const ASSEMBLYAI_REGION = (env('ASSEMBLYAI_REGION') ?? 'us').toLowerCase() === 'eu' ? 'eu' : 'us';

const ENDPOINTS: Record<string, Endpoint> = {
    assemblyai: {
        id: 'assemblyai',
        url: `https://${ASSEMBLYAI_REGION === 'eu' ? 'llm-gateway.eu' : 'llm-gateway'}.assemblyai.com/v1/chat/completions`,
        headers: () => {
            if (!assemblyaiApiKey) throw new Error('ASSEMBLYAI_API_KEY is not set');
            return { Authorization: assemblyaiApiKey };
        },
        defaultModel: assemblyaiLlmModel,
        extra: () => {
            // Only sent when set: not every Gateway model accepts them.
            const t = env('ASSEMBLYAI_LLM_TEMPERATURE');
            const r = env('ASSEMBLYAI_LLM_REASONING_EFFORT');
            return {
                max_tokens: Number(env('ASSEMBLYAI_LLM_MAX_TOKENS') ?? '300'),
                ...(t ? { temperature: Number(t) } : {}),
                ...(r ? { reasoning_effort: r } : {}),
            };
        },
    },
    mistral: {
        id: 'mistral',
        url: 'https://api.mistral.ai/v1/chat/completions',
        headers: () => {
            if (!mistralApiKey) throw new Error('MISTRAL_API_KEY is not set');
            return { Authorization: `Bearer ${mistralApiKey}` };
        },
        defaultModel: env('MISTRAL_LLM_MODEL') ?? 'mistral-large-4',
        extra: () => ({
            max_tokens: Number(env('MISTRAL_MAX_TOKENS') ?? '300'),
            temperature: Number(env('MISTRAL_TEMPERATURE') ?? '0.5'),
            // Large 4 is a reasoning model and no longer accepts "none"; "low" is the fastest.
            reasoning_effort: env('MISTRAL_REASONING_EFFORT') ?? 'low',
        }),
    },
};

export const LLM_PROVIDERS = Object.keys(ENDPOINTS);

// Content is usually a string, but reasoning models (Mistral Large 4) may send a list of
// parts: keep the spoken text, skip the thinking.
const textOf = (content: unknown): string | undefined => {
    if (typeof content === 'string') return content;
    if (!Array.isArray(content)) return undefined;
    const text = content.filter((p: any) => p?.type === 'text' && typeof p.text === 'string').map((p: any) => p.text).join('');
    return text || undefined;
};

export const createLlm = (provider: string, model?: string | null): LlmProvider => {
    const ep = ENDPOINTS[provider];
    if (!ep) throw new Error(`Unknown LLM provider: ${provider}`);
    const chosen = model || ep.defaultModel;
    return {
        id: ep.id,
        model: chosen,
        async *stream({ messages, tools, signal }) {
            const res = await fetch(ep.url, {
                method: 'POST',
                signal,
                headers: { ...ep.headers(), 'Content-Type': 'application/json', Accept: 'text/event-stream' },
                body: JSON.stringify({
                    model: chosen,
                    messages,
                    ...(tools.length ? { tools } : {}),
                    stream: true,
                    ...ep.extra(),
                }),
            });
            if (!res.ok || !res.body) {
                throw new Error(`${ep.id} LLM (${chosen}) failed: ${res.status} ${await res.text().catch(() => '')}`);
            }
            for await (const ev of sseJson(res.body)) {
                const delta = ev.choices?.[0]?.delta;
                if (!delta) continue;
                yield {
                    content: textOf(delta.content),
                    toolCalls: delta.tool_calls?.map((tc: any) => ({
                        index: tc.index ?? 0,
                        id: tc.id,
                        name: tc.function?.name,
                        args: tc.function?.arguments,
                    })),
                };
            }
        },
    };
};

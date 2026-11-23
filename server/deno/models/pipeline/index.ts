// Builds a pipeline from a character's three choices and runs it.
//
// A pipeline character (provider 'pipeline') stores:
//   stt_provider  'assemblyai' | 'mistral'
//   llm_provider  'assemblyai' (LLM Gateway) | 'mistral',  llm_model (null = provider default)
//   tts_provider  'assemblyai' | 'mistral',                oai_voice (that provider's voice id)
// Any combination works. Characters saved before the split (provider 'assemblyai' or
// 'mistral') run all three stages on that provider.
import { createLlm, LLM_PROVIDERS } from './llm/openai-compatible.ts';
import { runPipeline } from './runner.ts';
import { assemblyaiStt } from './stt/assemblyai.ts';
import { mistralStt } from './stt/mistral.ts';
import { assemblyaiTts } from './tts/assemblyai.ts';
import { mistralTts } from './tts/mistral.ts';
import type { SttProvider, TtsProvider } from './types.ts';

const STT: Record<string, SttProvider> = { assemblyai: assemblyaiStt, mistral: mistralStt };
const TTS: Record<string, TtsProvider> = { assemblyai: assemblyaiTts, mistral: mistralTts };

const pick = <T>(registry: Record<string, T>, id: string | null | undefined, fallback: string, stage: string): T => {
    const key = id || fallback;
    const found = registry[key];
    if (!found) throw new Error(`Unknown ${stage} provider: ${key}`);
    return found;
};

export const connectToPipeline = (args: ProviderArgs) => {
    const p = args.payload.user.personality;
    // Legacy single-provider characters: every stage on that provider.
    const legacy = p?.provider === 'assemblyai' || p?.provider === 'mistral' ? p.provider : 'assemblyai';
    const llmProvider = p?.llm_provider || legacy;
    if (!LLM_PROVIDERS.includes(llmProvider)) throw new Error(`Unknown LLM provider: ${llmProvider}`);

    return runPipeline(args, {
        stt: pick(STT, p?.stt_provider, legacy, 'STT'),
        llm: createLlm(llmProvider, p?.llm_model),
        tts: pick(TTS, p?.tts_provider, legacy, 'TTS'),
        voice: p?.oai_voice || null,
    });
};

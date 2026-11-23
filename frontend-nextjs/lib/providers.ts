// One place that says how each voice provider works, so the UI can group them.
//
//  - realtime: one speech-to-speech model listens, thinks and talks.
//  - pipeline: separate speech-to-text -> LLM -> text-to-speech stages, so each part can be
//    swapped (and the LLM can call tools).
//
// These are the providers the Deno server (server/deno) runs.
import {
    assemblyaiVoices,
    bosonVoices,
    geminiVoices,
    grokVoices,
    mistralVoices,
    openaiVoices,
} from "./data";

export type VoiceMode = "realtime" | "pipeline";

export type ProviderInfo = {
    provider: ModelProvider;
    label: string;
    mode: VoiceMode;
    voices: VoiceType[];
    badgeClass: string;
};

export const VOICE_MODES: { mode: VoiceMode; title: string; blurb: string }[] = [
    {
        mode: "realtime",
        title: "Realtime",
        blurb: "One speech-to-speech model. Lowest latency, most natural turn-taking.",
    },
    {
        mode: "pipeline",
        title: "Pipeline",
        blurb: "Speech-to-text → LLM → text-to-speech. Pick the brain, use tools and cloned voices.",
    },
];

export const PROVIDERS: ProviderInfo[] = [
    { provider: "openai", label: "OpenAI", mode: "realtime", voices: openaiVoices, badgeClass: "bg-emerald-500 text-white" },
    { provider: "gemini", label: "Gemini", mode: "realtime", voices: geminiVoices, badgeClass: "bg-purple-500 text-white" },
    { provider: "grok", label: "Grok", mode: "realtime", voices: grokVoices, badgeClass: "bg-slate-900 text-white" },
    { provider: "boson", label: "Boson", mode: "realtime", voices: bosonVoices, badgeClass: "bg-sky-600 text-white" },
    // Pipeline characters pick each stage separately (PIPELINE_STAGES below).
    { provider: "pipeline", label: "Pipeline", mode: "pipeline", voices: [], badgeClass: "bg-teal-600 text-white" },
];

export const providerInfo = (provider: ModelProvider): ProviderInfo | undefined =>
    PROVIDERS.find((p) => p.provider === provider);

// ---- Pipeline: three independent dropdowns ------------------------------------------
// Any speech-to-text works with any LLM and any text-to-speech (server/deno/models/pipeline).
// Saved on the character as stt_provider, llm_provider + llm_model, tts_provider + oai_voice.
export type StageProvider = "assemblyai" | "mistral";
export type PipelineStage = "stt" | "llm" | "tts";
export type PipelineOption = { id: string | null; label: string };
export type PipelineGroup = { provider: StageProvider; company: string; options: PipelineOption[] };

// Colored tag next to each dropdown: the company that serves that stage (and bills for it).
// Claude or Gemma picked on AssemblyAI's LLM Gateway are tagged AssemblyAI.
export const COMPANY_TAG: Record<string, string> = {
    AssemblyAI: "bg-teal-100 text-teal-800",
    Mistral: "bg-amber-100 text-amber-800",
};

const voiceOptions = (voices: VoiceType[]): PipelineOption[] =>
    voices.map((v) => ({ id: v.id, label: v.name }));

export const PIPELINE_STAGES: Record<PipelineStage, { label: string; groups: PipelineGroup[] }> = {
    stt: {
        label: "Speech-to-text",
        groups: [
            { provider: "assemblyai", company: "AssemblyAI", options: [{ id: null, label: "Universal-3.7 Realtime" }] },
            { provider: "mistral", company: "Mistral", options: [{ id: null, label: "Voxtral Realtime" }] },
        ],
    },
    llm: {
        label: "LLM",
        groups: [
            {
                provider: "assemblyai",
                company: "AssemblyAI",
                // Any LLM Gateway model works on the server; these are fast ones with tool calls.
                // Which ones a key can use depends on the AssemblyAI plan.
                options: [
                    { id: null, label: "Default" },
                    { id: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5" },
                    { id: "gemini-3.5-flash-lite", label: "Gemini 3.5 Flash Lite" },
                    { id: "gemini-2.5-flash-lite", label: "Gemini 2.5 Flash Lite" },
                    { id: "gpt-4.1", label: "GPT-4.1" },
                    { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6" },
                    { id: "gemma-4-31b", label: "Gemma 4 31B" },
                ],
            },
            { provider: "mistral", company: "Mistral", options: [{ id: null, label: "Mistral Large 4" }] },
        ],
    },
    tts: {
        label: "Text-to-speech",
        groups: [
            { provider: "assemblyai", company: "AssemblyAI", options: voiceOptions(assemblyaiVoices) },
            { provider: "mistral", company: "Mistral", options: voiceOptions(mistralVoices) },
        ],
    },
};

export const stageGroup = (stage: PipelineStage, provider: StageProvider) =>
    PIPELINE_STAGES[stage].groups.find((g) => g.provider === provider);

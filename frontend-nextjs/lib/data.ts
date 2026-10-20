export const defaultToyId: string = "56224f7f-250d-4351-84ee-e4a13b881c7b";
export const defaultPersonalityId: string =
    "a1c073e6-653d-40cf-acc1-891331689409";

export const paymentLink = "https://buy.stripe.com/bIY0033Dc7LB28o9AJ";
export const devkitPaymentLink = "https://buy.stripe.com/fZefZ12z82rh3cseV5";

export const discordInviteLink = "https://discord.gg/KJWxDPBRUj";
export const tiktokLink = "https://www.tiktok.com/@elatoai";
export const githubPublicLink = "https://github.com/akdeb/ElatoAI";
export const businessDemoLink = "https://calendly.com/akadeb/elato-ai-demo";
export const feedbackMailtoLink = `mailto:akash@elatoai.com?subject=${encodeURIComponent(
    "ElatoAI feedback"
)}&body=${encodeURIComponent(
    "What were you trying to do?\n\n\nWhat happened instead?\n\n"
)}`;
export const kickstarterLink = "https://www.kickstarter.com/projects/elatoai/elato-make-toys-talk-with-ai-voices";

export const r2Url = "https://pub-cd736d767add4fecafea55c239c28497.r2.dev";
export const r2UrlAudio = "https://pub-5fab8e2596c544cd8dc3e20812be2168.r2.dev";

export const videoSrc = `${r2Url}/IMG_1673.mov`;
export const videoSrc2 = `${r2Url}/IMG_1675.mov`;
export const videoSrc3 = `${r2Url}/IMG_1676.mov`;
export const videoSrc4 = `${r2Url}/IMG_1677.mov`;

export const voiceSampleUrl =
    "https://xygbupeczfhwamhqnucy.supabase.co/storage/v1/object/public/voices/";

export const userFormPersonaLabel =
    "Briefly describe yourself and your interests, personality, and learning style";
export const userFormPersonaPlaceholder =
    "Don't get me started on the guitar...I love to shred it like Hendrix. I also like a good challenge. Challenge me to be better and I'll rise to the occasion.";
export const userFormAgeLabel = "Your Age";
export const userFormAgeDescription =
    "Users under 13 years old must have a parent or guardian to setup Elato.";
export const userFormNameLabel = "Your Name";

export const INITIAL_CREDITS = 50;
export const SECONDS_PER_CREDIT = (30 * 60) / INITIAL_CREDITS; // 30 minutes equals 50 credits

export const DEVICE_COST = 55;
export const ORIGINAL_COST = 111;
export const SUBSCRIPTION_COST = 10;

export const openaiVoices: VoiceType[] = [
    {
        id: "alloy",
        name: "Alloy",
        description: "Neutral and balanced",
        color: "bg-blue-100",
        emoji: "🧑",
        provider: "openai",
    },
    {
        id: "echo",
        name: "Echo",
        description: "Warm and melodic",
        color: "bg-purple-100",
        emoji: "👩‍🎤",
        provider: "openai",
    },
    {
        id: "shimmer",
        name: "Shimmer",
        description: "Clear and bright",
        color: "bg-cyan-100",
        emoji: "👱‍♀️",
        provider: "openai",
    },
    {
        id: "ash",
        name: "Ash",
        description: "Soft and thoughtful",
        color: "bg-gray-100",
        emoji: "🧔",
        provider: "openai",
    },
    {
        id: "ballad",
        name: "Ballad",
        description: "Melodic and emotive",
        color: "bg-indigo-100",
        emoji: "🎭",
        provider: "openai",
    },
    {
        id: "coral",
        name: "Coral",
        description: "Warm and friendly",
        color: "bg-orange-100",
        emoji: "👩",
        provider: "openai",
    },
    {
        id: "sage",
        name: "Sage",
        description: "Wise and measured",
        color: "bg-green-100",
        emoji: "🧓",
        provider: "openai",
    },
    {
        id: "verse",
        name: "Verse",
        description: "Poetic and expressive",
        color: "bg-rose-100",
        emoji: "👨‍🎨",
        provider: "openai",
    },
];

export const grokVoices: VoiceType[] = [
    {
        id: "Ara",
        name: "Ara",
        description: "Bright",
        color: "bg-yellow-100",
        provider: "grok",
    },
    {
        id: "Eve",
        name: "Eve",
        description: "Upbeat",
        color: "bg-orange-100",
        provider: "grok",
    },
    {
        id: "Leo",
        name: "Leo",
        description: "Confident",
        color: "bg-blue-100",
        provider: "grok",
    },
    {
        id: "Rex",
        name: "Rex",
        description: "Direct",
        color: "bg-gray-100",
        provider: "grok",
    },
    {
        id: "Sal",
        name: "Sal",
        description: "Warm",
        color: "bg-green-100",
        provider: "grok",
    }
];

export const bosonVoices: VoiceType[] = [
    {
        id: "chloe",
        name: "Chloe",
        description: "Friendly and clear",
        color: "bg-sky-50",
        emoji: "🎙️",
        provider: "boson",
    },
    {
        id: "eleanor",
        name: "Eleanor",
        description: "Calm and articulate",
        color: "bg-indigo-50",
        emoji: "🎙️",
        provider: "boson",
    },
    {
        id: "nora",
        name: "Nora",
        description: "Calm and clear",
        color: "bg-violet-50",
        emoji: "🎙️",
        provider: "boson",
    },
    {
        id: "jake",
        name: "Jake",
        description: "Energetic",
        color: "bg-emerald-50",
        emoji: "🎙️",
        provider: "boson",
    },
    {
        id: "marcus",
        name: "Marcus",
        description: "Enthusiastic",
        color: "bg-amber-50",
        emoji: "🎙️",
        provider: "boson",
    },
    {
        id: "oliver",
        name: "Oliver",
        description: "Calm and articulate",
        color: "bg-teal-50",
        emoji: "🎙️",
        provider: "boson",
    },
    {
        id: "yujin",
        name: "Yujin",
        description: "Bright and personable",
        color: "bg-rose-50",
        emoji: "🎙️",
        provider: "boson",
    },
    {
        id: "jiho",
        name: "Jiho",
        description: "Friendly and reassuring",
        color: "bg-blue-50",
        emoji: "🎙️",
        provider: "boson",
    },
];

export const mistralVoices: VoiceType[] = [
    {
        id: "en_paul_neutral",
        name: "Paul - Neutral",
        description: "English (US), neutral",
        color: "bg-slate-100",
        provider: "mistral",
    },
    {
        id: "en_paul_happy",
        name: "Paul - Happy",
        description: "English (US), happy",
        color: "bg-green-100",
        provider: "mistral",
    },
    {
        id: "en_paul_cheerful",
        name: "Paul - Cheerful",
        description: "English (US), cheerful",
        color: "bg-green-100",
        provider: "mistral",
    },
    {
        id: "en_paul_excited",
        name: "Paul - Excited",
        description: "English (US), excited",
        color: "bg-orange-100",
        provider: "mistral",
    },
    {
        id: "en_paul_confident",
        name: "Paul - Confident",
        description: "English (US), confident",
        color: "bg-blue-100",
        provider: "mistral",
    },
    {
        id: "en_paul_sad",
        name: "Paul - Sad",
        description: "English (US), sad",
        color: "bg-indigo-100",
        provider: "mistral",
    },
    {
        id: "en_paul_frustrated",
        name: "Paul - Frustrated",
        description: "English (US), frustrated",
        color: "bg-red-100",
        provider: "mistral",
    },
    {
        id: "en_paul_angry",
        name: "Paul - Angry",
        description: "English (US), angry",
        color: "bg-red-100",
        provider: "mistral",
    },
    {
        id: "gb_oliver_neutral",
        name: "Oliver - Neutral",
        description: "English (UK), neutral",
        color: "bg-slate-100",
        provider: "mistral",
    },
    {
        id: "gb_oliver_cheerful",
        name: "Oliver - Cheerful",
        description: "English (UK), cheerful",
        color: "bg-green-100",
        provider: "mistral",
    },
    {
        id: "gb_oliver_curious",
        name: "Oliver - Curious",
        description: "English (UK), curious",
        color: "bg-green-100",
        provider: "mistral",
    },
    {
        id: "gb_oliver_confident",
        name: "Oliver - Confident",
        description: "English (UK), confident",
        color: "bg-blue-100",
        provider: "mistral",
    },
    {
        id: "gb_oliver_excited",
        name: "Oliver - Excited",
        description: "English (UK), excited",
        color: "bg-orange-100",
        provider: "mistral",
    },
    {
        id: "gb_oliver_sad",
        name: "Oliver - Sad",
        description: "English (UK), sad",
        color: "bg-indigo-100",
        provider: "mistral",
    },
    {
        id: "gb_oliver_angry",
        name: "Oliver - Angry",
        description: "English (UK), angry",
        color: "bg-red-100",
        provider: "mistral",
    },
    {
        id: "gb_jane_neutral",
        name: "Jane - Neutral",
        description: "English (UK), neutral",
        color: "bg-slate-100",
        provider: "mistral",
    },
    {
        id: "gb_jane_curious",
        name: "Jane - Curious",
        description: "English (UK), curious",
        color: "bg-green-100",
        provider: "mistral",
    },
    {
        id: "gb_jane_confident",
        name: "Jane - Confident",
        description: "English (UK), confident",
        color: "bg-blue-100",
        provider: "mistral",
    },
    {
        id: "gb_jane_confused",
        name: "Jane - Confused",
        description: "English (UK), confused",
        color: "bg-violet-100",
        provider: "mistral",
    },
    {
        id: "gb_jane_sarcasm",
        name: "Jane - Sarcasm",
        description: "English (UK), sarcasm",
        color: "bg-fuchsia-100",
        provider: "mistral",
    },
    {
        id: "gb_jane_shameful",
        name: "Jane - Shameful",
        description: "English (UK), shameful",
        color: "bg-amber-100",
        provider: "mistral",
    },
    {
        id: "gb_jane_sad",
        name: "Jane - Sad",
        description: "English (UK), sad",
        color: "bg-indigo-100",
        provider: "mistral",
    },
    {
        id: "gb_jane_jealousy",
        name: "Jane - Jealousy",
        description: "English (UK), jealousy",
        color: "bg-rose-100",
        provider: "mistral",
    },
    {
        id: "gb_jane_frustrated",
        name: "Jane - Frustrated",
        description: "English (UK), frustrated",
        color: "bg-red-100",
        provider: "mistral",
    },
    {
        id: "fr_marie_neutral",
        name: "Marie - Neutral",
        description: "French, neutral",
        color: "bg-slate-100",
        provider: "mistral",
    },
    {
        id: "fr_marie_happy",
        name: "Marie - Happy",
        description: "French, happy",
        color: "bg-green-100",
        provider: "mistral",
    },
    {
        id: "fr_marie_curious",
        name: "Marie - Curious",
        description: "French, curious",
        color: "bg-green-100",
        provider: "mistral",
    },
    {
        id: "fr_marie_excited",
        name: "Marie - Excited",
        description: "French, excited",
        color: "bg-orange-100",
        provider: "mistral",
    },
    {
        id: "fr_marie_sad",
        name: "Marie - Sad",
        description: "French, sad",
        color: "bg-indigo-100",
        provider: "mistral",
    },
    {
        id: "fr_marie_angry",
        name: "Marie - Angry",
        description: "French, angry",
        color: "bg-red-100",
        provider: "mistral",
    },
];

export const geminiVoices: VoiceType[] = [
    {
        id: "Zephyr",
        name: "Zephyr",
        description: "Bright",
        color: "bg-yellow-100",
        provider: "gemini",
    },
    {
        id: "Puck",
        name: "Puck",
        description: "Upbeat",
        color: "bg-orange-100",
        provider: "gemini",
    },
    {
        id: "Charon",
        name: "Charon",
        description: "Informative",
        color: "bg-blue-100",
        provider: "gemini",
    },
    {
        id: "Kore",
        name: "Kore",
        description: "Firm",
        color: "bg-gray-100",
        provider: "gemini",
    },
    {
        id: "Fenrir",
        name: "Fenrir",
        description: "Excitable",
        color: "bg-red-100",
        provider: "gemini",
    },
    {
        id: "Leda",
        name: "Leda",
        description: "Youthful",
        color: "bg-pink-100",
        provider: "gemini",
    },
    {
        id: "Orus",
        name: "Orus",
        description: "Firm",
        color: "bg-slate-100",
        provider: "gemini",
    },
    {
        id: "Aoede",
        name: "Aoede",
        description: "Breezy",
        color: "bg-sky-100",
        provider: "gemini",
    },
    {
        id: "Callirrhoe",
        name: "Callirrhoe",
        description: "Easy-going",
        color: "bg-green-100",
        provider: "gemini",
    },
    {
        id: "Autonoe",
        name: "Autonoe",
        description: "Bright",
        color: "bg-amber-100",
        provider: "gemini",
    },
    {
        id: "Enceladus",
        name: "Enceladus",
        description: "Breathy",
        color: "bg-cyan-100",
        provider: "gemini",
    },
    {
        id: "Iapetus",
        name: "Iapetus",
        description: "Clear",
        color: "bg-white",
        provider: "gemini",
    },
    {
        id: "Umbriel",
        name: "Umbriel",
        description: "Easy-going",
        color: "bg-emerald-100",
        provider: "gemini",
    },
    {
        id: "Algieba",
        name: "Algieba",
        description: "Smooth",
        color: "bg-violet-100",
        provider: "gemini",
    },
    {
        id: "Despina",
        name: "Despina",
        description: "Smooth",
        color: "bg-purple-100",
        provider: "gemini",
    },
    {
        id: "Erinome",
        name: "Erinome",
        description: "Clear",
        color: "bg-neutral-100",
        provider: "gemini",
    },
    {
        id: "Algenib",
        name: "Algenib",
        description: "Gravelly",
        color: "bg-stone-100",
        provider: "gemini",
    },
    {
        id: "Rasalgethi",
        name: "Rasalgethi",
        description: "Informative",
        color: "bg-indigo-100",
        provider: "gemini",
    },
    {
        id: "Laomedeia",
        name: "Laomedeia",
        description: "Upbeat",
        color: "bg-lime-100",
        provider: "gemini",
    },
    {
        id: "Achernar",
        name: "Achernar",
        description: "Soft",
        color: "bg-rose-100",
        provider: "gemini",
    },
    {
        id: "Alnilam",
        name: "Alnilam",
        description: "Firm",
        color: "bg-zinc-100",
        provider: "gemini",
    },
    {
        id: "Schedar",
        name: "Schedar",
        description: "Even",
        color: "bg-teal-100",
        provider: "gemini",
    },
    {
        id: "Gacrux",
        name: "Gacrux",
        description: "Mature",
        color: "bg-brown-100",
        provider: "gemini",
    },
    {
        id: "Pulcherrima",
        name: "Pulcherrima",
        description: "Forward",
        color: "bg-fuchsia-100",
        provider: "gemini",
    },
    {
        id: "Achird",
        name: "Achird",
        description: "Friendly",
        color: "bg-yellow-100",
        provider: "gemini",
    },
    {
        id: "Zubenelgenubi",
        name: "Zubenelgenubi",
        description: "Casual",
        color: "bg-orange-100",
        provider: "gemini",
    },
    {
        id: "Vindemiatrix",
        name: "Vindemiatrix",
        description: "Gentle",
        color: "bg-green-100",
        provider: "gemini",
    },
    {
        id: "Sadachbia",
        name: "Sadachbia",
        description: "Lively",
        color: "bg-red-100",
        provider: "gemini",
    },
    {
        id: "Sadaltager",
        name: "Sadaltager",
        description: "Knowledgeable",
        color: "bg-blue-100",
        provider: "gemini",
    },
    {
        id: "Sulafat",
        name: "Sulafat",
        description: "Warm",
        color: "bg-orange-100",
        provider: "gemini",
    },
];

export const emotionOptions = [
    { value: "neutral", label: "Neutral", icon: "😐", color: "bg-red-100" },
    {
        value: "cheerful",
        label: "Cheerful",
        icon: "😊",
        color: "bg-yellow-100",
    },
    { value: "serious", label: "Serious", icon: "🧐", color: "bg-blue-100" },
    { value: "calm", label: "Calm", icon: "😌", color: "bg-teal-100" },
    { value: "excited", label: "Excited", icon: "😃", color: "bg-orange-100" },
    {
        value: "professional",
        label: "Professional",
        icon: "👔",
        color: "bg-green-100",
    },
];

import { SupabaseClient } from "@supabase/supabase-js";

declare global {
    interface IConversation {
        conversation_id: string;
        role: "user" | "assistant";
        content: string;
        user_id: string;
        is_sensitive: boolean;
        personality_key: string;
        created_at: string;
    }

    interface IPayload {
        user: IUser;
        supabase: SupabaseClient;
        timestamp: string;
    }

    interface IDevice {
        device_id: string;
        volume: number;
        is_ota: boolean;
        is_reset: boolean;
        mac_address: string;
        user_code: string;
    }

    type ModelProvider = "openai" | "gemini" | "elevenlabs" | "hume";

    type GeminiVoice =
        | "Zephyr"
        | "Puck"
        | "Charon"
        | "Kore"
        | "Fenrir"
        | "Leda"
        | "Orus"
        | "Aoede"
        | "Callirrhoe"
        | "Autonoe"
        | "Enceladus"
        | "Iapetus"
        | "Umbriel"
        | "Algieba"
        | "Despina"
        | "Erinome"
        | "Algenib"
        | "Rasalgethi"
        | "Laomedeia"
        | "Achernar"
        | "Alnilam"
        | "Schedar"
        | "Gacrux"
        | "Pulcherrima"
        | "Achird"
        | "Zubenelgenubi"
        | "Vindemiatrix"
        | "Sadachbia"
        | "Sadaltager"
        | "Sulafat";

    type OaiVoice =
        | "ash"
        | "alloy"
        | "echo"
        | "shimmer"
        | "ballad"
        | "coral"
        | "sage"
        | "verse";

    /**
     * Note: oai_voice is essentially the name of the voice. 
     * the naming here sucks, please change it
     */
    interface IPersonality {
        personality_id: string;
        is_doctor: boolean;
        is_child_voice: boolean;
        is_story: boolean;
        key: string;
        oai_voice: string;
        provider: ModelProvider;
        voice_description: string;
        title: string;
        subtitle: string;
        short_description: string;
        character_prompt: string;
        voice_prompt: string;
        creator_id: string | null;
        pitch_factor: number;
        first_message_prompt: string;
    }

    interface ILanguage {
        language_id: string;
        code: string;
        name: string;
        flag: string;
    }

    interface IDoctorMetadata {
        doctor_name: string;
        specialization: string;
        hospital_name: string;
        favorite_phrases: string;
    }

    interface IUserMetadata {}
    interface IBusinessMetadata {}

    type UserInfo =
        | {
            user_type: "user";
            user_metadata: IUserMetadata;
        }
        | {
            user_type: "doctor";
            user_metadata: IDoctorMetadata;
        }
        | {
            user_type: "business";
            user_metadata: IBusinessMetadata;
        };

    interface IUser {
        user_id: string;
        avatar_url: string;
        is_premium: boolean;
        email: string;
        supervisor_name: string;
        supervisee_name: string;
        supervisee_persona: string;
        supervisee_age: number;
        personality_id: string;
        personality?: IPersonality;
        language: ILanguage;
        language_code: string;
        session_time: number;
        user_info: UserInfo;
        device_id: string;
        device?: IDevice;
    }

    // Hume EVI WebSocket message types
    interface HumeMessage {
        type: string;
        [key: string]: any;
    }

    interface HumeAudioInput {
        type: 'audio_input';
        data: string; // base64 encoded audio
    }

    interface HumeUserInput {
        type: 'user_input';
        text: string;
    }

    interface HumeAssistantInput {
        type: 'assistant_input';
        text: string;
    }

    interface HumeSessionSettings {
        type: 'session_settings';
        [key: string]: any;
    }

    interface HumeAssistantMessage {
        type: 'assistant_message';
        message: {
            role: 'assistant';
            content: string;
        };
        models: {
            prosody?: {
                scores: Record<string, number>;
            };
        };
    }

    interface HumeAudioOutput {
        type: 'audio_output';
        data: string; // base64 encoded audio
    }

    interface HumeError {
        type: 'error';
        code: string;
        message: string;
    }
}

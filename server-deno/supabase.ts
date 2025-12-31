import { createClient, SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { decryptSecret } from "./utils.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseKey = Deno.env.get("SUPABASE_KEY")!;

if (!supabaseUrl || !supabaseKey) {
    throw new Error("SUPABASE_URL or SUPABASE_KEY is not set");
}

export function getSupabaseClient(userJwt: string) {
    return createClient(supabaseUrl, supabaseKey, {
        global: {
            headers: {
                Authorization: `Bearer ${userJwt}`,
            },
        },
    });
}

export const getUserByEmail = async (
    supabase: SupabaseClient,
    email: string,
): Promise<IUser> => {
    const { data, error } = await supabase.from("users").select(
        "*, language:languages(name), personality:personalities!users_personality_id_fkey(*), device:device_id(is_reset, is_ota, volume, mac_address)",
    ).eq("email", email);

    console.log("data", data, error);

    if (error) {
        throw new Error("Failed to authenticate user");
    }
    return data[0] as IUser;
};

export const getDeviceInfo = async (
    supabase: SupabaseClient,
    userId: string,
): Promise<IDevice | null> => {
    const { data, error } = await supabase.from("devices").select("*").eq(
        "user_id",
        userId,
    )
        .single();
    if (error) return null;
    return data as IDevice;
};

export const composeChatHistory = (data: IConversation[]) => {
    const messages = data.map((chat: IConversation) =>
        `${chat.role} [${
            new Date(chat.created_at).toISOString()
        }]: ${chat.content}`
    ).join("\n");

    return messages;
};

export const getChatHistory = async (
    supabase: SupabaseClient,
    userId: string,
    personalityKey: string | null,
    isDoctor: boolean,
): Promise<IConversation[]> => {
    try {
        let query = supabase
            .from("conversations")
            .select("*")
            .eq("user_id", userId)
            .order("created_at", { ascending: false })
            .limit(20);

        if (personalityKey) {
            query = query.eq("personality_key", personalityKey);
        }

        // If isDoctor is true, only fetch conversations from the last 2 hours
        if (isDoctor) {
            // Calculate timestamp from 2 hours ago
            const twoHoursAgo = new Date();
            twoHoursAgo.setHours(twoHoursAgo.getHours() - 2);

            // Add timestamp filter to query
            query = query.gte("created_at", twoHoursAgo.toISOString());
        }

        const { data, error } = await query;
        if (error) throw error;
        return data;
    } catch (_e: any) {
        return [];
    }
};

const UserPromptTemplate = (user: IUser) => `
YOU ARE TALKING TO someone whose name is: ${user.supervisee_name} and age is: ${user.supervisee_age} with a personality described as: ${user.supervisee_persona}.

Do not ask for personal information.
Your physical form is in the form of a physical object or a toy.
A person interacts with you by pressing a button, sends you instructions and you must respond in a concise conversational style.
`;

const getStoryPromptTemplate = (user: IUser, chatHistory: string) => {
    const childName = user.supervisee_name;
    const childAge = user.supervisee_age;
    const childInterests = user.supervisee_persona;
    const title = user.personality?.title;
    const characterPrompt = user.personality?.character_prompt;
    const voicePrompt = user.personality?.voice_prompt;

    return `
You are a lively, imaginative storyteller character named ${title}. You are about to create a fun and exciting adventure story for ${childName}, who is ${childAge} years old. ${childName} loves ${childInterests}. 
  
  Your storytelling style must:
  - Narrate the story as the main character and engage with the child.
  - Assume you are speaking to a child named ${childName} directly.
  - Be creative, immersive, and interactive.
  - Include frequent pauses or questions to let ${childName} influence what happens next.
  - Feature themes and elements closely related to ${childName}'s interests.
  - Be age-appropriate, friendly, playful, and positive.
  
  Your Character Description:
  ${characterPrompt}
  
  Your Voice Description:
  ${voicePrompt}
  
  Storytelling Guidelines:
  - Begin the story by directly addressing ${childName} and introducing an interesting scenario related to their interests.
  - After every 4-5 sentences or at key decision moments, pause and ask ${childName} what should happen next or present a choice.
  - Incorporate their responses naturally and creatively to shape the ongoing narrative.
  - Conclude the story positively, reinforcing curiosity, creativity, kindness, or bravery.
  
  Chat History:
  ${chatHistory}
  
  Let's begin the adventure now!
    `;
};

const getCommonPromptTemplate = (
    chatHistory: string,
    user: IUser,
    timestamp: string,
) => `
Your Voice Description: ${user.personality?.voice_prompt}

Your Character Description: ${user.personality?.character_prompt}

The default language is: ${user.language.name} but you must switch to any other language if the user asks for it.

The current time is: ${timestamp}

This is the chat history.
${chatHistory}
`;

export const createFirstMessage = (
    payload: IPayload,
): string => {
    const { timestamp, user } = payload;

    const firstMessagePrompt = user.personality?.first_message_prompt
        ? `Always start the conversation following these instructions from the user: ${user.personality?.first_message_prompt}`
        : "Say hello to the user";

    return firstMessagePrompt;
};

export const createSystemPrompt = (
    chatHistory: IConversation[],
    payload: IPayload,
): string => {
    const { user, timestamp } = payload;
    const chatHistoryString = composeChatHistory(chatHistory);
    console.log("chatHistoryString", chatHistoryString);
    const commonPrompt = getCommonPromptTemplate(
        chatHistoryString,
        user,
        timestamp,
    );

    const isStory = user.personality?.is_story;
    if (isStory) {
        const storyPrompt = getStoryPromptTemplate(user, chatHistoryString);
        return storyPrompt;
    }

    let systemPrompt: string;
    switch (user.user_info.user_type) {
        case "user":
            systemPrompt = UserPromptTemplate(user);
            break;
        default:
            throw new Error("Invalid user type");
    }
    return commonPrompt + systemPrompt;
};

export const addConversation = async (
    supabase: SupabaseClient,
    speaker: "user" | "assistant",
    content: string,
    user: IUser,
): Promise<void> => {
    const { error } = await supabase.from("conversations").insert({
        role: speaker,
        content,
        user_id: user.user_id,
        is_sensitive: false,
        personality_key: user.personality?.key,
    });

    if (error) {
        throw new Error("Failed to add conversation");
    }
};

/**
 * Get the OpenAI API Key for the user
 * @param supabase - The Supabase client
 * @param userId - The user's ID
 * @returns The OpenAI API Key
 *
 * Tip: You can use the `getOpenAiApiKey` function to get the OpenAI API Key for the user.
 * Or you can store your own OpenAI API Key in the environment variable `OPENAI_API_KEY`.
 */
export const getOpenAiApiKey = async (
    supabase: SupabaseClient,
    userId: string,
): Promise<string> => {
    const { data, error } = await supabase
        .from("api_keys")
        .select("encrypted_key, iv")
        .eq("user_id", userId)
        .single();

    if (error) throw error;

    const { encrypted_key, iv } = data;
    const masterKey = Deno.env.get("ENCRYPTION_KEY")!;

    const decryptedKey = decryptSecret(encrypted_key, iv, masterKey);

    return decryptedKey;
};

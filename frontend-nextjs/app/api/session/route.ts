import { createClient } from "@/utils/supabase/server";
import { SupabaseClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { getUserById } from "@/db/users";

interface IPayload {
  user: IUser;
  supabase: SupabaseClient;
  timestamp: string;
}

const getChatHistory = async (
  supabase: SupabaseClient,
  userId: string,
  personalityKey: string | null,
): Promise<string> => {
  try {
    let query = supabase
      .from("conversations")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(10);

    if (personalityKey) {
      query = query.eq("personality_key", personalityKey);
    }

    const { data, error } = await query;
    if (error) throw error;

    const messages = data.map((chat: IConversation) =>
      `${chat.role}: ${chat.content}`
    )
      .join("\n");

    return messages;
  } catch (error: any) {
    throw new Error(`Failed to get chat history: ${error.message}`);
  }
};

const UserPromptTemplate = (user: IUser) => `
YOU ARE TALKING TO someone whose name is: ${user.supervisee_name} and age is: ${user.supervisee_age} with a personality described as: ${user.supervisee_persona}.

Do not ask for personal information.
Your physical form is in the form of a physical object or a toy.
A person interacts with you by pressing a button, sends you instructions and you must respond in a concise conversational style.
`;

const getCommonPromptTemplate = (
  chatHistory: string,
  user: IUser,
  timestamp: string,
) => `
YOUR VOICE IS: ${user.personality?.voice_prompt}

YOUR CHARACTER PROMPT IS: ${user.personality?.character_prompt}
CHAT HISTORY:
${chatHistory}

USER'S CURRENT TIME IS: ${timestamp}

LANGUAGE:
You may talk in any language the user would like, but the default language is ${
  user?.language?.name ?? "English"
}.
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

const createSystemPrompt = async (
  payload: IPayload,
): Promise<string> => {
  const { user, supabase, timestamp } = payload;
  const chatHistory = await getChatHistory(
    supabase,
    user.user_id,
    user.personality?.key ?? null,
  );
  const commonPrompt = getCommonPromptTemplate(chatHistory, user, timestamp);

  const isStory = user.personality?.is_story;
  if (isStory) {
    const storyPrompt = getStoryPromptTemplate(user, chatHistory);
    return storyPrompt;
  }

  let systemPrompt;
  switch (user.user_info.user_type) {
    case "user":
      systemPrompt = UserPromptTemplate(user);
      break;
    default:
      throw new Error("Invalid user type");
  }
  return systemPrompt + commonPrompt;
};

export async function GET(request: NextRequest) {
  const supabase = createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const dbUser = await getUserById(supabase, user.id);
  if (!dbUser) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const openAiApiKey = process.env.OPENAI_API_KEY;
  const systemPrompt = await createSystemPrompt({
    user: dbUser,
    supabase,
    timestamp: new Date().toISOString(),
  });

  try {
    const response = await fetch(
      "https://api.openai.com/v1/realtime/sessions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${openAiApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "gpt-realtime-1.5",
          instructions: systemPrompt,
          voice: dbUser.personality?.oai_voice ?? "ballad",
        }),
      },
    );
    console.log(response);
    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error("Error in /session:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 },
    );
  }
}

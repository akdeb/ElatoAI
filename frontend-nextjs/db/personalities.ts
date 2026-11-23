import { SupabaseClient } from "@supabase/supabase-js";

export const createPersonality = async (
    supabase: SupabaseClient,
    userId: string,
    personality: IPersonality,
): Promise<IPersonality | null> => {
    const { data, error } = await supabase
        .from("personalities")
        .insert({
            ...personality,
            creator_id: userId,
        }).select();

    if (error) {
        console.error("Error creating personality:", error);
        throw error;
    }

    return data ? data[0] : null;
};

// Only the creator can update (RLS: personalities_update_own).
export const updatePersonality = async (
    supabase: SupabaseClient,
    personalityId: string,
    fields: Partial<IPersonality>,
): Promise<IPersonality | null> => {
    const { data, error } = await supabase
        .from("personalities")
        .update(fields)
        .eq("personality_id", personalityId)
        .select();

    if (error) {
        console.error("Error updating personality:", error);
        throw error;
    }
    // RLS filters out rows you don't own: no row back means nothing was updated.
    if (!data?.length) throw new Error("Character not found or not yours");
    return data[0];
};

export const getPersonalityById = async (
    supabase: SupabaseClient,
    personalityId: string,
) => {
    const { data, error } = await supabase
        .from("personalities")
        .select(`*`)
        .eq("personality_id", personalityId);

    if (error) {
        console.log("error getPersonalityById", error);
        return null;
    }

    return data[0] as IPersonality;
};

export const getAllPersonalities = async (supabase: SupabaseClient) => {
    const { data, error } = await supabase
        .from("personalities")
        .select(`*`)
        .is("creator_id", null)
        .order("created_at", { ascending: false });

    if (error) {
        console.log("error getAllPersonalities", error);
        return [];
    }

    return data as IPersonality[];
};

export const getMyPersonalities = async (
    supabase: SupabaseClient,
    userId: string,
) => {
    const { data, error } = await supabase
        .from("personalities")
        .select(`*`)
        .eq("creator_id", userId)
        .order("created_at", { ascending: false });

    if (error) {
        console.log("error getMyPersonalities", error);
        return [];
    }

    return data as IPersonality[];
};

import BuildDashboard from "@/app/components/CreateCharacter/BuildDashboard";
import { getAllLanguages } from "@/db/languages";
import { getPersonalityById } from "@/db/personalities";
import { getUserById } from "@/db/users";
import { getOpenGraphMetadata } from "@/lib/utils";
import { createClient } from "@/utils/supabase/server";
import { Metadata } from "next";
import { redirect } from "next/navigation";

export const metadata: Metadata = {
    title: "Edit character",
    ...getOpenGraphMetadata("Edit character"),
};

export default async function EditCharacter({ params }: { params: { id: string } }) {
    const supabase = createClient();

    const {
        data: { user },
    } = await supabase.auth.getUser();
    if (!user) redirect("/login");

    const [dbUser, personality, allLanguages] = await Promise.all([
        getUserById(supabase, user.id),
        getPersonalityById(supabase, params.id),
        getAllLanguages(supabase),
    ]);

    // Only your own characters can be edited.
    if (!dbUser || !personality || personality.creator_id !== user.id) redirect("/home");

    return (
        <div className="pb-4 flex flex-col gap-2">
            <BuildDashboard selectedUser={dbUser} allLanguages={allLanguages} personality={personality} />
        </div>
    );
}

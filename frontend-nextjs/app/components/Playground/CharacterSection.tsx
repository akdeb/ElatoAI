import ModifyCharacterSheet from "./ModifyCharacterSheet";
import Link from "next/link";
import Image from "next/image";
import { cn, getPersonalityImageSrc } from "@/lib/utils";
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";
import { Check, CheckCircle, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmojiComponent } from "./EmojiImage";

interface CharacterSectionProps {
    allPersonalities: IPersonality[];
    languageState: string;
    personalityIdState: string;
    onPersonalityPicked: (personalityIdPicked: string) => void;
    title: string;
    disableButtons: boolean;
    selectedFilters: PersonalityFilter[];
}

const CharacterSection = ({
    allPersonalities,
    languageState,
    personalityIdState,
    onPersonalityPicked,
    title,
    disableButtons,
    selectedFilters,
}: CharacterSectionProps) => {

    const filteredPersonalities = allPersonalities.filter((personality) => {
        return selectedFilters.every((filter) => {
            return personality[filter] === true;
        });
    });

    if (filteredPersonalities.length === 0) {
        return null;
    }

    return (
        <div className="flex flex-col gap-2 w-full">
            <p className="text-sm text-gray-600 self-start flex flex-row items-center gap-2">
                <span>{title}</span>
            </p>
            <div className="w-full">
                <div className="grid grid-cols-2 lg:grid-cols-4 md:gap-6 gap-4">
                    {filteredPersonalities.map((personality, index) => {
                        const isCurrentPersonality = personalityIdState === personality.personality_id;
                        return (
                        <ModifyCharacterSheet
                        key={personality.personality_id}
                        openPersonality={personality}
                        languageState={languageState}
                        isCurrentPersonality={isCurrentPersonality}
                        onPersonalityPicked={onPersonalityPicked}
                        disableButtons={disableButtons}
                    >
                        <Card
                            className={cn(
                                "p-0 rounded-3xl cursor-pointer shadow-lg transition-all hover:scale-103 flex flex-col",
                                personalityIdState === personality.personality_id
                                    ? "border-primary border-2"
                                    : "hover:border-primary/50"
                            )}
                            // onClick={() => onPersonalityPicked(personality)}
                        >
                            <CardContent className="flex-shrink-0 p-0 h-[160px] sm:h-[180px] relative">
                                {personality.creator_id === null ? (
                                    <Image
                                        src={getPersonalityImageSrc(personality.key)}
                                        alt={personality.key}
                                        width={100}
                                        height={180}
                                    className="rounded-3xl rounded-br-none rounded-bl-none w-full h-full object-cover"
                                />
                                ) : (
                                    <div className="flex flex-row items-center justify-center h-full">
                                        <EmojiComponent personality={personality} />
                                    </div>
                                )}
                                <Button
                                    size="sm"
                                    variant={isCurrentPersonality ? "default" : "outline"}
                                    className={`absolute shadow-lg top-2 right-2 rounded-full h-9 w-9 p-0 ${isCurrentPersonality ? "bg-primary text-primary-foreground" : ""}`}
                                    onClick={() => onPersonalityPicked(personality.personality_id!)}
                                    aria-label={isCurrentPersonality ? "Deselect feature" : "Select feature"}
                                >
                                    {true ? (
                                        <Check className="h-4 w-4" strokeWidth={3} />
                                    ) : (
                                        <CheckCircle className="h-4 w-4" strokeWidth={3} />
                                    )}
                                </Button>
                                {/* Your own characters (built-ins have no creator) get an edit shortcut. */}
                                {personality.creator_id !== null && (
                                    <Button
                                        asChild
                                        size="sm"
                                        variant="ghost"
                                        className="absolute top-2 right-12 h-9 w-9 p-0 text-gray-600 hover:text-gray-900 hover:bg-transparent"
                                    >
                                        <Link
                                            href={`/home/edit/${personality.personality_id}`}
                                            aria-label={`Edit ${personality.title}`}
                                            // Don't also open the character sheet this card triggers.
                                            onClick={(e) => e.stopPropagation()}
                                        >
                                            <Pencil className="h-4 w-4" strokeWidth={2.5} />
                                        </Link>
                                    </Button>
                                )}
                            </CardContent>
                            <CardHeader className="flex-shrink-0 gap-0 px-4 py-2">
                                <CardTitle className="font-semibold text-md flex flex-row items-center gap-2">
                                    {personality.title}  
                                </CardTitle>
                                <CardDescription className="text-sm font-normal">
                                    {personality.subtitle}
                                </CardDescription>
                            </CardHeader>
                        </Card>
                        </ModifyCharacterSheet>
                    );
                    })}
                </div>
            </div>
        </div>
    );
};

export default CharacterSection;

import { Button } from "@/components/ui/button";
import { providerInfo } from "@/lib/providers";
import {
    Sheet,
    SheetClose,
    SheetContent,
    SheetTrigger,
} from "@/components/ui/sheet";
import Image from "next/image";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { Airplay, Check, MonitorSmartphone, Pencil, Phone } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Drawer, DrawerContent, DrawerTrigger } from "@/components/ui/drawer";
import { getPersonalityImageSrc } from "@/lib/utils";
import { EmojiComponent } from "./EmojiImage";
import { Badge } from "@/components/ui/badge";

interface ModifyCharacterSheetProps {
    openPersonality: IPersonality;
    isCurrentPersonality: boolean;
    children: React.ReactNode;
    onPersonalityPicked: (personalityIdPicked: string) => void;
    languageState: string;
    disableButtons: boolean;
}

const ModifyCharacterSheet: React.FC<ModifyCharacterSheetProps> = ({
    openPersonality,
    isCurrentPersonality,
    children,
    onPersonalityPicked,
    languageState,
    disableButtons,
}) => {
    const [isSent, setIsSent] = useState(false);

    const isDesktop = useMediaQuery("(min-width: 768px)");

    const isPersonalCharacter = openPersonality.creator_id !== null;
    const isDoctor = openPersonality.is_doctor;

    const ButtonsComponent = () => {
        return (
            <div className="flex flex-row gap-4 p-4 ">
                <Button
                    size="lg"
                    className={`w-full rounded-full text-sm md:text-lg flex flex-row items-center gap-1 md:gap-2 transition-colors duration-300 ${
                        isSent || isCurrentPersonality
                            ? "bg-green-500 hover:bg-green-600"
                            : ""
                    }`}
                    variant={disableButtons ? "upsell_primary" : "default"}
                    disabled={isCurrentPersonality || disableButtons}
                    onClick={() => {
                        setIsSent(true);
                        onPersonalityPicked(openPersonality.personality_id!);
                        setTimeout(() => setIsSent(false), 10000);
                    }}
                >
                    <Check className="flex-shrink-0 h-5 w-5 md:h-6 md:w-6" />
                    {isSent || isCurrentPersonality
                        ? "Live character"
                        : "Click to chat"}
                </Button>
                {/* Your own characters (built-ins have no creator) can be edited. */}
                {isPersonalCharacter && (
                    <Button asChild size="lg" variant="ghost" className="flex-shrink-0 px-2 text-gray-600 hover:text-gray-900 hover:bg-transparent">
                        <Link href={`/home/edit/${openPersonality.personality_id}`} aria-label={`Edit ${openPersonality.title}`}>
                            <Pencil className="h-5 w-5" />
                        </Link>
                    </Button>
                )}
            </div>
        );
    };

    const PersonalCharacterComponent = () => {
        return (
            <>
            <p className="text-gray-400">
                        {"Character prompt"}
                    </p>
                    <p className="text-gray-600 whitespace-pre-line">
                            {openPersonality.character_prompt}
                        </p>
                        <p className="text-gray-400">
                        {"First message prompt"}
                    </p>
                    <p className="text-gray-600">
                            {openPersonality.first_message_prompt}
                        </p>
                     <p className="text-gray-400">
                        {"Voice prompt"}
                    </p>
                    <p className="text-gray-600">
                            {openPersonality.voice_prompt}
                        </p>
            </>
        );
    };

    const ContentComponent = () => {
        return (
            <div className="container mx-auto p-4 max-w-4xl">
                <div className="flex flex-col items-center gap-6">
                    {isPersonalCharacter ? (
                        <div className="relative w-full h-[100px] sm:h-[200px] flex items-center justify-center">
                        <EmojiComponent personality={openPersonality} size={100} />
                        </div>
                    ) : (
                        <div className="relative w-full h-[300px] sm:h-[400px]">
                            <Image
                                src={getPersonalityImageSrc(openPersonality.key)}
                                alt={openPersonality.title}
                                className="rounded-lg object-top sm:object-center object-cover"
                                fill
                                // style={{
                                //     objectFit: "cover",
                            //     objectPosition: "top sm:center",
                            // }}
                            />
                        </div>
                    )}
                    <div className="space-y-2 text-left w-full relative">
                    <div className="absolute top-0 right-0">
                    <Badge variant="outline">
                        {(() => {
                            const info = providerInfo(openPersonality.provider);
                            if (openPersonality.provider === "pipeline") {
                                // e.g. "assemblyai → gemma-4-31b → mistral"
                                const p = openPersonality;
                                return `${p.stt_provider} → ${p.llm_model ?? p.llm_provider} → ${p.tts_provider}`;
                            }
                            return info ? `${info.label} · Realtime` : openPersonality.provider;
                        })()}
                    </Badge>
                </div>
                    <div className="flex flex-row items-center gap-2">
                        <h3 className="text-xl font-semibold">
                            {openPersonality.title}
                        </h3>
                    </div>

                    <p className="text-gray-400">
                        {openPersonality.subtitle}
                    </p>
                    <p className="text-gray-600">
                        {openPersonality.short_description}
                    </p>
                    {(isPersonalCharacter || isDoctor) && (
                        <PersonalCharacterComponent />
                    )}
                </div>
                </div>
            </div>
        );
    };

    if (isDesktop) {
        return (
            <Sheet>
                <SheetTrigger asChild>{children}</SheetTrigger>
                <SheetContent
                    className="rounded-tl-xl gap-0 rounded-bl-xl overflow-y-auto p-0"
                    style={{ maxWidth: "500px" }}
                    side="right"
                >
                    <div className="min-h-[100dvh] flex flex-col">
                        <div className="flex-1">
                            <ContentComponent />
                        </div>
                        <div className="sticky bottom-0 w-full bg-background border-t">
                            <ButtonsComponent />
                        </div>
                    </div>
                </SheetContent>
            </Sheet>
        );
    }

    return (
        <Drawer>
            <DrawerTrigger asChild>{children}</DrawerTrigger>
            <DrawerContent className="h-[70vh]">
                <div className="flex flex-col h-full overflow-y-auto">
                    <div className="flex-shrink-0">
                        <ButtonsComponent />
                    </div>
                    <div className="flex-1 overflow-y-auto">
                        <ContentComponent />
                    </div>
                </div>
            </DrawerContent>
        </Drawer>
    );
};

export default ModifyCharacterSheet;

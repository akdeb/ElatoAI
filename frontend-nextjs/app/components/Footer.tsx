"use client";

import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { FaDiscord, FaGithub, FaTiktok } from "react-icons/fa";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
    discordInviteLink,
    githubPublicLink,
    tiktokLink,
} from "@/lib/data";
import { useMediaQuery } from "@/hooks/useMediaQuery";

export default function Footer() {
    const pathname = usePathname();
    const isHome = pathname.includes("/home");
    const isMobile = useMediaQuery("(max-width: 768px)");
    // const isRoot = pathname === "/";
    return (
        <footer
            className={`w-full ${
                isHome ? "pb-16" : "pb-2"
            } border-gray-200 flex flex-col sm:flex-row items-center sm:justify-center border-t-[1px] mx-auto text-center text-xs sm:gap-8 sm:py-1 py-2`}
        >
            <div className="flex flex-row items-center gap-8">
                <Label className={`font-normal text-xs text-gray-500`}>
                   Made with ❤️ by Elato AI © {new Date().getFullYear()}
                </Label>
            </div>
            {/* <Separator orientation="vertical" /> */}
            <div
                className={`flex-row items-center gap-8 ${
                    isHome && isMobile ? "hidden" : "flex"
                }`}
            >
                <div className="flex flex-row items-center gap-2">
                    <Link href={githubPublicLink} passHref>
                        <Button
                            variant="ghost"
                            size="icon"
                            className={`w-7 h-7 text-gray-500`}
                        >
                            <FaGithub />
                        </Button>
                    </Link>
                    <Link href={discordInviteLink} passHref>
                        <Button
                            variant="ghost"
                            size="icon"
                            className={`w-7 h-7 text-gray-500`}
                        >
                            <FaDiscord />
                        </Button>
                    </Link>
                    <Link href={tiktokLink} passHref>
                        <Button
                            variant="ghost"
                            size="icon"
                            className={`w-7 h-7 text-gray-500`}
                        >
                            <FaTiktok />
                        </Button>
                    </Link>
                </div>
            </div>

            {/* <ThemeSwitcher /> */}
        </footer>
    );
}

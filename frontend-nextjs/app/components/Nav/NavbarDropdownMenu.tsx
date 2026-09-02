import {
    Mail,
    Menu,
    CalendarCheck,
    Star,
    Box,
    LogIn,
    HomeIcon,
    Hospital,
    BookOpen,
    Blocks,
    Gamepad2,
    Cpu,
} from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
    DropdownMenu,
DropdownMenuContent,
    DropdownMenuGroup,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { FaDiscord, FaGithub } from "react-icons/fa";
import {
    businessDemoLink,
    discordInviteLink,
    feedbackMailtoLink,
    githubPublicLink,
} from "@/lib/data";
import PremiumBadge from "../PremiumBadge";
import { useEffect, useState } from "react";
import { isPremiumUser } from "@/app/actions";
import { DropdownMenuLabel } from "@radix-ui/react-dropdown-menu";
import { usePathname } from "next/navigation";
interface NavbarMenuButtonProps {
    user: IUser | null;
    stars: number | null;
}
const ICON_SIZE = 22;

export function NavbarDropdownMenu({ user, stars }: NavbarMenuButtonProps) {
    const [premiumUser, setPremiumUser] = useState(false);
    const pathname = usePathname();

    useEffect(() => {
        const setUserPremium = async () => {
            if (user) {
                const isPremium = await isPremiumUser(user.user_id);
                setPremiumUser(isPremium ?? false);
            }
        };
        setUserPremium();
    }, [user]);

    const LoggedInItems: React.FC = () => {
        return (
            <DropdownMenuItem>
                <Link
                    href="/home"
                    passHref
                    className="flex flex-row gap-2 w-full"
                >
                    <HomeIcon size={ICON_SIZE} />
                    <span>Home</span>
                </Link>
            </DropdownMenuItem>
        );
    };

    const LoggedOutItems: React.FC = () => {
        return (
            <DropdownMenuItem>
                <Link
                    href="/login"
                    passHref
                    className="flex flex-row gap-2 w-full"
                >
                    <LogIn size={ICON_SIZE} />
                    <span>Login</span>
                </Link>
            </DropdownMenuItem>
        );
    };

    return (
        <DropdownMenu
            onOpenChange={(open) => {
                if (!open) {
                    // Remove focus from any active element when dropdown closes
                    document.activeElement instanceof HTMLElement &&
                        document.activeElement.blur();
                }
            }}
        >
            <DropdownMenuTrigger asChild>
                <Button
                    variant="ghost"
                    size="sm"
                    className="flex flex-row gap-2 items-center rounded-full 
                    focus:outline-none focus:ring-0 focus:ring-transparent 
                    focus-visible:outline-none focus-visible:ring-0 focus-visible:ring-transparent 
                    shadow-none focus:shadow-none focus-visible:shadow-none"                    >
                    <Menu size={20} />
                    <span className="hidden sm:flex font-normal">
                        {user ? "Home" : "Login"}
                    </span>
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
                className="w-60 p-2 sm:mt-2 rounded-lg"
                side="bottom"
                align="end"
            >
                {!!user && premiumUser ? (
                    <DropdownMenuLabel className="flex w-full justify-center">
                        <PremiumBadge currentUserId={user.user_id} displayText />
                    </DropdownMenuLabel>
                ) : null}
                <DropdownMenuGroup>
                    {user ? <LoggedInItems /> : <LoggedOutItems />}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem>
                        <Link
                            href={businessDemoLink}
                            passHref
                            className="flex flex-row gap-2 w-full"
                        >
                            <CalendarCheck size={ICON_SIZE} />
                            <span>Business Demo</span>
                        </Link>
                    </DropdownMenuItem>
                </DropdownMenuGroup>
                <DropdownMenuItem>
                    <Link
                        href={githubPublicLink}
                        target="_blank"
                        rel="noopener noreferrer"
                        title="Visit our GitHub"
                        className="flex flex-row items-center gap-2 w-full"
                    >
                        <FaGithub size={ICON_SIZE} />
                        <span>GitHub</span>
                    </Link>
                </DropdownMenuItem>
                <DropdownMenuItem>
                    <Link
                        href={discordInviteLink}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex flex-row items-center gap-2 w-full"
                    >
                        <FaDiscord size={ICON_SIZE} />
                        <span>Discord</span>
                    </Link>
                </DropdownMenuItem>
                <DropdownMenuItem>
                    <a
                        href={feedbackMailtoLink}
                        className="flex flex-row items-center gap-2 w-full"
                    >
                        <Mail size={ICON_SIZE - 2} />
                        <span>Send feedback</span>
                    </a>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <div className="flex flex-row gap-2">
    <Link
        href="https://elatoai.com/products"
        passHref
        className="flex rounded-lg flex-row gap-2 items-center flex-1 bg-amber-100 dark:bg-amber-900/40 px-2 py-2 text-amber-800 dark:text-amber-200 hover:bg-yellow-100 dark:hover:bg-amber-900/60 transition-colors"
    >
        <Box
            size={ICON_SIZE}
            className="text-amber-600 dark:text-amber-400"
        />
        <div className="flex flex-col items-center">
            <span className="font-medium text-xs text-amber-900 dark:text-amber-200">
                AI Device
            </span>
            <span className="text-xs text-amber-600 dark:text-amber-400">
                Buy Now
            </span>
        </div>
    </Link>
    <Link
        href="https://elatoai.com/products/ai-devkit"
        passHref
        className="flex rounded-lg flex-row gap-2 items-center flex-1 bg-blue-100 dark:bg-blue-900/40 px-2 py-2 text-blue-800 dark:text-blue-200 hover:bg-blue-200 dark:hover:bg-blue-900/60 transition-colors"
    >
        <Cpu
            size={ICON_SIZE}
            className="text-blue-600 dark:text-blue-400"
        />
        <div className="flex flex-col items-center">
            <span className="font-medium text-xs text-blue-900 dark:text-blue-200">
                AI Devkit
            </span>
            <span className="text-xs text-blue-600 dark:text-blue-400">
                Buy Now
            </span>
        </div>
    </Link>
</div>
            </DropdownMenuContent>
        </DropdownMenu>
    );
}

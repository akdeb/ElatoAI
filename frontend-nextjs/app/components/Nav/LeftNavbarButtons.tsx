import { Button } from "@/components/ui/button";
import { Home, Sparkle, ChevronDown, Dog, Bird, Hop, Plus, Blocks, Gamepad2, Link } from "lucide-react";
import {
    DropdownMenuSeparator,
    DropdownMenu,
    DropdownMenuItem,
    DropdownMenuGroup,
    DropdownMenuContent,
    DropdownMenuTrigger,
    DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import { usePathname } from "next/navigation";
import Image from "next/image";

const ICON_SIZE = 22;

interface LeftNavbarButtonsProps {
    user: IUser | null;
}

export default function LeftNavbarButtons({ user }: LeftNavbarButtonsProps) {
    const isDoctor = user?.user_info.user_type === "doctor";
    const pathname = usePathname();

    let firstWordOfHospital = '';
    if (isDoctor) {
        const hospitalName = (user?.user_info.user_metadata as IDoctorMetadata).hospital_name; 
        firstWordOfHospital = hospitalName ? hospitalName.split(' ')[0] : '';
    }

    const isRoot = pathname === "/";
    const isHome = pathname.includes("/home");

    const shouldShowHospital = isDoctor && firstWordOfHospital.length && isHome;

    return (
        <div className="flex flex-row gap-4 sm:gap-10 items-center">
        <Button
            variant="outline"
            className="flex flex-row gap-2 items-center px-4 py-2 rounded-lg"
            asChild
            aria-label="Go to Home page"
            title="Click to go to Home page"
        >
            <a href="https://www.elatoai.com">
                <Link size={18} className="mr-1" />
                <span className="text-md font-normal mr-1">Main Website</span>
                <p className="flex items-center font-luckiestGuy tracking-widest text-xl mt-1">
                    <span>Elato</span>
                </p>
                <Image src="/logos/elato.png" alt="Elato Logo" width={24} height={24} />
            </a>
        </Button>
    </div>
    );
}

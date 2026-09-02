"use client";

import { MessageCircleQuestion } from "lucide-react";

import { cn } from "@/lib/utils";
import { feedbackMailtoLink } from "@/lib/data";

function openFeedbackEmail() {
    window.location.href = feedbackMailtoLink;
}

export function FeedbackButton({ mobile = false }: { mobile?: boolean }) {
    return (
        <button
            type="button"
            onClick={openFeedbackEmail}
            aria-label="Send feedback"
            title="Send feedback"
            className={cn(
                "group flex items-center transition-colors",
                mobile
                    ? "fixed bottom-20 right-4 z-50 h-12 w-12 justify-center rounded-full border border-stone-200 bg-white text-stone-700 shadow-lg hover:bg-yellow-50 hover:text-stone-950 md:hidden"
                    : "ml-4 mt-3 w-fit px-4 py-2 text-sm text-stone-500 underline decoration-stone-400 underline-offset-4 hover:text-stone-700"
            )}
        >
            {mobile && (
                <MessageCircleQuestion
                    size={22}
                    className="transition-transform group-hover:-rotate-6"
                />
            )}
            {!mobile && <span>Send feedback</span>}
        </button>
    );
}

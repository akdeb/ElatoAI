"use client";

import { useEffect, useState } from "react";
import { Battery } from "lucide-react";
import { createClient } from "@/utils/supabase/client";

type BatteryReading = Pick<IDevice, "battery_percent" | "battery_voltage_mv" | "battery_updated_at">;

export default function DeviceBattery({ userId }: { userId: string }) {
    const [reading, setReading] = useState<BatteryReading | null>(null);
    const [loading, setLoading] = useState(true);
    const [failed, setFailed] = useState(false);
    const [now, setNow] = useState(Date.now());

    useEffect(() => {
        const supabase = createClient();
        let cancelled = false;
        let inFlight = false;
        setReading(null);
        setLoading(true);
        setFailed(false);
        const refresh = async () => {
            if (document.hidden || inFlight) return;
            inFlight = true;
            try {
                const { data, error } = await supabase.from("devices")
                    .select("battery_percent,battery_voltage_mv,battery_updated_at")
                    .eq("user_id", userId).maybeSingle();
                if (!cancelled) {
                    if (error) setFailed(true);
                    else { setReading(data); setFailed(false); }
                }
            } catch {
                if (!cancelled) setFailed(true);
            } finally {
                inFlight = false;
                if (!cancelled) { setLoading(false); setNow(Date.now()); }
            }
        };
        void refresh();
        const timer = window.setInterval(refresh, 30000);
        document.addEventListener("visibilitychange", refresh);
        return () => {
            cancelled = true;
            window.clearInterval(timer);
            document.removeEventListener("visibilitychange", refresh);
        };
    }, [userId]);

    const percent = reading?.battery_percent;
    const hasReading = typeof percent === "number" && Number.isFinite(percent);
    const updatedAt = reading?.battery_updated_at ? Date.parse(reading.battery_updated_at) : NaN;
    const ageMinutes = Number.isFinite(updatedAt) ? Math.max(0, Math.floor((now - updatedAt) / 60000)) : null;
    const age = ageMinutes === null ? "" : ageMinutes === 0 ? "just now" :
        ageMinutes < 60 ? `${ageMinutes} min ago` :
        ageMinutes < 1440 ? `${Math.floor(ageMinutes / 60)} hr ago` :
        `${Math.floor(ageMinutes / 1440)} days ago`;

    return (
        <div className="flex flex-col gap-2 mt-6" aria-live="polite">
            <div className="flex items-center justify-between sm:w-1/2">
                <span className="flex items-center gap-2 text-sm font-medium text-gray-700">
                    <Battery size={18} aria-hidden="true" /> Device battery
                </span>
                <span className="text-sm text-gray-700">
                    {hasReading ? `${Math.round(percent)}%` : "—"}
                </span>
            </div>
            {hasReading && <progress className="w-full sm:w-1/2 h-2 accent-purple-600"
                aria-label="Device battery percentage" max={100} value={percent} />}
            <p className="text-xs text-gray-500">
                {loading ? "Checking battery…" : hasReading ? <>
                    {reading?.battery_voltage_mv != null && `${(reading.battery_voltage_mv / 1000).toFixed(2)} V · `}
                    <span title={reading?.battery_updated_at ?? undefined}>Last reported {age || "at an unknown time"}.</span>
                    {ageMinutes !== null && ageMinutes >= 15 && " Wake the device to refresh its reading."}
                    {failed && " Could not refresh; showing the last received reading."}
                </> : failed ? "Battery reading unavailable. Try again shortly." :
                    "No battery reading yet. Wake your device and connect it to Wi-Fi."}
            </p>
        </div>
    );
}

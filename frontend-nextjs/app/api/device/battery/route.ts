import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import jwt from "jsonwebtoken";

// Accept the existing device JWT, including tokens already saved in NVS.
export async function POST(req: Request) {
    const token = req.headers.get("authorization")?.match(/^Bearer (.+)$/)?.[1];
    if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const secret = process.env.JWT_SECRET_KEY;
    if (!secret) return NextResponse.json({ error: "Battery service unavailable" }, { status: 503 });

    let userId: string;
    try {
        const claims = jwt.verify(token, secret, {
            algorithms: ["HS256"], audience: "authenticated",
        });
        if (typeof claims === "string" || typeof claims.sub !== "string" || !claims.sub) {
            throw new Error("Missing subject");
        }
        userId = claims.sub;
    } catch {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    let body;
    try {
        body = await req.json();
    } catch {
        return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }
    if (!body || typeof body.mac_address !== "string" ||
        !/^([0-9a-f]{2}:){5}[0-9a-f]{2}$/i.test(body.mac_address) ||
        typeof body.battery_percent !== "number" || !Number.isFinite(body.battery_percent) ||
        body.battery_percent < 0 || body.battery_percent > 100 ||
        !Number.isInteger(body.battery_voltage_mv) ||
        body.battery_voltage_mv < 2500 || body.battery_voltage_mv > 4500) {
        return NextResponse.json({ error: "Invalid battery reading" }, { status: 400 });
    }

    try {
        // Stateless client: use this device's bearer token, never browser cookies
        // or a service role. Both owner and MAC must match the registered device.
        const supabase = createClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
            { global: { headers: { Authorization: `Bearer ${token}` } },
                auth: { persistSession: false, autoRefreshToken: false } },
        );
        const { data, error } = await supabase.from("devices").update({
            battery_percent: body.battery_percent,
            battery_voltage_mv: body.battery_voltage_mv,
            battery_updated_at: new Date().toISOString(),
        }).eq("user_id", userId).eq("mac_address", body.mac_address.toUpperCase())
            .select("device_id").maybeSingle();
        if (error) {
            console.error("Battery telemetry database update failed", error.code);
            return NextResponse.json({ error: "Could not save battery reading" }, { status: 500 });
        }
        if (!data) return NextResponse.json({ error: "Device not registered to this user" }, { status: 403 });
        return NextResponse.json({ success: true });
    } catch {
        return NextResponse.json({ error: "Battery service unavailable" }, { status: 503 });
    }
}

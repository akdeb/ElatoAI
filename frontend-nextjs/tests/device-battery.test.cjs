// Run: node --test tests/device-battery.test.cjs
// Exercise the real route, JWT verification, and Supabase client against a
// local PostgREST stand-in. No production credentials or database are used.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { createServer } = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const jwt = require("jsonwebtoken");

const secret = "battery-test-secret-only";
const owner = "b2feb374-77f4-4fe0-bc41-278538c62848";
const mac = "AA:BB:CC:DD:EE:FF";
const valid = { mac_address: mac, battery_percent: 64.5, battery_voltage_mv: 3875 };
const keys = ["JWT_SECRET_KEY", "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY"];
const saved = Object.fromEntries(keys.map(key => [key, process.env[key]]));
let server, POST, calls = [], result = "success";

const token = (claims = {}, key = secret) => jwt.sign({
    sub: owner, aud: "authenticated", role: "authenticated", ...claims,
}, key, { algorithm: "HS256" });
const request = (body = valid, auth = token()) => new Request("http://localhost/api/device/battery", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(auth ? { Authorization: `Bearer ${auth}` } : {}) },
    body: JSON.stringify(body),
});

before(async () => {
    server = createServer(async (req, res) => {
        let body = "";
        for await (const chunk of req) body += chunk;
        calls.push({ method: req.method, url: new URL(req.url, "http://localhost"),
            auth: req.headers.authorization, body: JSON.parse(body) });
        res.setHeader("Content-Type", "application/json");
        if (result === "error") {
            res.statusCode = 400;
            res.end(JSON.stringify({ code: "42703", message: "column does not exist" }));
        } else if (result === "missing") {
            // PATCH + maybeSingle requests PostgREST's singular-object response.
            res.statusCode = 406;
            res.end(JSON.stringify({ code: "PGRST116", details: "The result contains 0 rows",
                message: "JSON object requested, multiple (or no) rows returned" }));
        } else res.end(JSON.stringify({ device_id: "test-device" }));
    });
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    process.env.JWT_SECRET_KEY = secret;
    process.env.NEXT_PUBLIC_SUPABASE_URL = `http://127.0.0.1:${server.address().port}`;
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key";
    const source = fs.readFileSync(path.join(__dirname, "../app/api/device/battery/route.ts"), "utf8");
    const compiled = ts.transpileModule(source, { compilerOptions: {
        module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true,
    } }).outputText;
    const mod = { exports: {} };
    new Function("require", "module", "exports", compiled)(require, mod, mod.exports);
    POST = mod.exports.POST;
});

after(async () => {
    await new Promise(resolve => server.close(resolve));
    for (const key of keys) {
        if (saved[key] === undefined) delete process.env[key];
        else process.env[key] = saved[key];
    }
});

test("accepts an existing device token and scopes writes to owner AND MAC", async () => {
    const auth = token();
    const beforeTime = Date.now();
    const response = await POST(request({ ...valid, mac_address: mac.toLowerCase(),
        user_id: "attacker", battery_updated_at: "2000-01-01T00:00:00Z" }, auth));
    assert.equal(response.status, 200);
    const call = calls.at(-1);
    assert.equal(call.method, "PATCH");
    assert.equal(call.url.pathname, "/rest/v1/devices");
    assert.equal(call.url.searchParams.get("user_id"), `eq.${owner}`);
    assert.equal(call.url.searchParams.get("mac_address"), `eq.${mac}`);
    assert.equal(call.auth, `Bearer ${auth}`);
    assert.equal(call.body.battery_percent, 64.5);
    assert.equal(call.body.battery_voltage_mv, 3875);
    assert.ok(Date.parse(call.body.battery_updated_at) >= beforeTime);
    assert.equal(Object.keys(call.body).length, 3);
});

test("0% and 100% are valid readings", async () => {
    for (const battery_percent of [0, 100]) {
        assert.equal((await POST(request({ ...valid, battery_percent }))).status, 200);
        assert.equal(calls.at(-1).body.battery_percent, battery_percent);
    }
});

test("rejects missing, forged, expired, wrong-audience, and subjectless tokens before touching DB", async () => {
    const count = calls.length;
    for (const auth of [null, "garbage", token({}, "wrong-secret"),
        token({ exp: 1 }), token({ aud: "other" }), token({ sub: undefined })]) {
        assert.equal((await POST(request(valid, auth))).status, 401);
    }
    assert.equal(calls.length, count);
});

test("rejects malformed telemetry without overwriting the last reading", async () => {
    const count = calls.length;
    for (const body of [null, {}, { ...valid, battery_percent: -1 },
        { ...valid, battery_percent: 101 }, { ...valid, battery_percent: "50" },
        { ...valid, battery_percent: null }, { ...valid, battery_voltage_mv: 2499 },
        { ...valid, battery_voltage_mv: 4501 }, { ...valid, battery_voltage_mv: 3800.5 },
        { ...valid, mac_address: "invalid" }]) {
        assert.equal((await POST(request(body))).status, 400);
    }
    const malformed = new Request("http://localhost/api/device/battery", {
        method: "POST", headers: { Authorization: `Bearer ${token()}` }, body: "{",
    });
    assert.equal((await POST(malformed)).status, 400);
    assert.equal(calls.length, count);
});

test("does not report success when no owned device matches", async () => {
    result = "missing";
    assert.equal((await POST(request())).status, 403);
    result = "success";
});

test("database errors are retryable failures", async () => {
    result = "error";
    assert.equal((await POST(request())).status, 500);
    result = "success";
});

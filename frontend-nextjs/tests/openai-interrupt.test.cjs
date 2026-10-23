// Offline integration checks of the actual Deno bridge, without API calls.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

async function bridge() {
    const sent = [], deviceMessages = [], handlers = {}, deviceHandlers = {};
    const audio = { pushes: 0, flushes: 0, resets: 0 };
    class Client {
        constructor() {
            this.realtime = {
                on: (event, fn) => { handlers[event] = fn; },
                send: (type, payload) => sent.push({ type, ...payload }),
            };
            this.conversation = {
                EventProcessors: { "response.created": true, "response.output_item.added": true,
                    "response.output_audio.delta": true },
                // 100ms of 24kHz mono PCM16.
                processEvent: () => ({ delta: { audio: new Int16Array(2400) } }),
            };
        }
        addTool() {}
        async connect() {}
        isConnected() { return true; }
        disconnect() {}
    }
    const mocks = {
        "node:buffer": require("node:buffer"),
        "../realtime/client.js": { RealtimeClient: Client },
        "../realtime/utils.js": { RealtimeUtils: { generateId: () => "test-event" } },
        "../supabase.ts": { addConversation: async () => {}, getDeviceInfo: async () => ({ volume: 70 }) },
        "../utils.ts": { isDev: false, openaiApiKey: "test-key", defaultOpenAIVoice: "echo",
            createOpusPacketizer: () => ({ push: () => audio.pushes++, flush: () => audio.flushes++,
                reset: () => audio.resets++, close: () => {} }) },
    };
    const source = fs.readFileSync(path.join(__dirname, "../../server/deno/models/openai.ts"), "utf8");
    const compiled = ts.transpileModule(source, { compilerOptions: {
        module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true,
    } }).outputText;
    const mod = { exports: {} };
    new Function("require", "module", "exports", "console", compiled)(name => {
        assert.ok(name in mocks, `Unexpected dependency ${name}`);
        return mocks[name];
    }, mod, mod.exports, { log() {}, error() {} });
    await mod.exports.connectToOpenAI({
        ws: { on: (event, fn) => { deviceHandlers[event] = fn; },
            send: text => deviceMessages.push(JSON.parse(text)), close() {} },
        payload: { user: { user_id: "test", personality: { oai_voice: "echo" } }, supabase: {} },
        connectionPcmFile: null, firstMessage: "", systemPrompt: "", closeHandler: async () => {},
    });
    const server = event => handlers["server.*"](event);
    const interrupt = async (audio_end_ms = 5000) => {
        deviceHandlers.message(Buffer.from(JSON.stringify({ type: "instruction", msg: "INTERRUPT", audio_end_ms })), false);
        await new Promise(resolve => setImmediate(resolve));
    };
    const start = async () => {
        await server({ type: "response.created" });
        await server({ type: "response.output_item.added", item: { id: "assistant-audio", type: "message", role: "assistant" } });
        await server({ type: "response.output_audio.delta" });
    };
    const done = () => server({ type: "response.done", response: { usage: { output_token_details: { audio_tokens: 1 } } } });
    return { sent, deviceMessages, audio, server, interrupt, start, done };
}

test("interrupt cancels generation and clamps history trimming to received audio", async () => {
    const b = await bridge();
    await b.start();
    await b.interrupt();
    assert.equal(b.sent.filter(e => e.type === "response.cancel").length, 1);
    const truncate = b.sent.find(e => e.type === "conversation.item.truncate");
    assert.equal(truncate.item_id, "assistant-audio");
    assert.equal(truncate.audio_end_ms, 100);
    assert.ok(b.sent.some(e => e.type === "input_audio_buffer.clear"));
});

test("late audio/completion after interruption cannot restart playback", async () => {
    const b = await bridge();
    await b.start();
    await b.interrupt();
    const pushes = b.audio.pushes;
    await b.server({ type: "response.output_audio.delta" });
    await b.done();
    assert.equal(b.audio.pushes, pushes);
    assert.equal(b.audio.flushes, 0);
    assert.ok(!b.deviceMessages.some(e => e.msg === "RESPONSE.COMPLETE"));
    await b.start();
    await b.done();
    assert.equal(b.audio.pushes, pushes + 1);
    assert.equal(b.audio.flushes, 1);
    assert.ok(b.deviceMessages.some(e => e.msg === "RESPONSE.COMPLETE"));
});

test("buffered playback can be interrupted after generation has finished", async () => {
    const b = await bridge();
    await b.start();
    await b.done();
    await b.interrupt(-100);
    assert.ok(!b.sent.some(e => e.type === "response.cancel"));
    assert.equal(b.sent.find(e => e.type === "conversation.item.truncate").audio_end_ms, 0);
});

test("interrupt before an audio item arrives never truncates an old item", async () => {
    const b = await bridge();
    await b.start();
    await b.done();
    await b.server({ type: "response.created" });
    await b.interrupt();
    assert.equal(b.sent.filter(e => e.type === "response.cancel").length, 1);
    assert.ok(!b.sent.some(e => e.type === "conversation.item.truncate"));
});

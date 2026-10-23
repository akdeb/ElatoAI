const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

function load(file) {
    const compiled = ts.transpileModule(fs.readFileSync(file, "utf8"), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    }).outputText;
    const mod = { exports: {} };
    new Function("require", "module", "exports", compiled)(name => load(path.resolve(path.dirname(file), name)), mod, mod.exports);
    return mod.exports;
}

test("socket frames after disconnect or replacement cannot touch cleared conversation state", async () => {
    const original = globalThis.WebSocket;
    const sockets = [];
    class Socket extends EventTarget {
        constructor() {
            super(); sockets.push(this);
            queueMicrotask(() => this.dispatchEvent(new Event("open")));
        }
        close() {}
        message(id) {
            this.dispatchEvent(new MessageEvent("message", {
                data: JSON.stringify({ type: "response.output_audio_transcript.delta", item_id: id }),
            }));
        }
    }
    globalThis.WebSocket = Socket;
    try {
        const { RealtimeAPI } = load(path.join(__dirname, "../../server/deno/realtime/api.js"));
        const api = new RealtimeAPI({ apiKey: "test-only", url: "ws://not-a-real-server" });
        const received = [];
        api.on("server.*", event => received.push(event.item_id));
        await api.connect();
        sockets[0].message("active-first");
        api.disconnect();
        sockets[0].message("late-after-sleep");
        assert.deepEqual(received, ["active-first"]);
        await api.connect();
        sockets[0].message("late-from-previous-session");
        sockets[1].message("active-second");
        assert.deepEqual(received, ["active-first", "active-second"]);
        api.disconnect();
    } finally {
        globalThis.WebSocket = original;
    }
});

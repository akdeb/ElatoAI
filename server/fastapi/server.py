"""Multi-transport Pipecat server for browser and ESP32 over WebSocket."""

from __future__ import annotations

import json
import os

import uvicorn
from fastapi import FastAPI, WebSocket
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, RedirectResponse
from loguru import logger
from pipecat.transports.websocket.fastapi import FastAPIWebsocketParams

from bot import create_esp32_auth_message, run_bot_session
from esp32_transport import BrowserWebsocketTransport, Esp32WebsocketTransport, RawPCMFrameSerializer
from models.providers import get_provider_catalog, validate_classic_provider_stack

HOST = os.getenv("HOST", "0.0.0.0")
PORT = int(os.getenv("PORT", "7860"))
BROWSER_INPUT_SAMPLE_RATE = int(os.getenv("BROWSER_INPUT_SAMPLE_RATE", "16000"))
ESP32_INPUT_SAMPLE_RATE = int(os.getenv("ESP32_INPUT_SAMPLE_RATE", "16000"))
AUDIO_OUTPUT_SAMPLE_RATE = int(os.getenv("AUDIO_OUTPUT_SAMPLE_RATE", "24000"))
ALLOWED_ORIGINS = [
    origin.strip()
    for origin in os.getenv("ALLOWED_ORIGINS", "*").split(",")
    if origin.strip()
]

BROWSER_HTML = """<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Pipecat Browser WS</title>
  <style>
    body { font-family: system-ui, sans-serif; margin: 24px; background: #0e0f14; color: #f5f7fb; }
    .wrap { max-width: 920px; margin: 0 auto; }
    .row { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; }
    button { padding: 10px 16px; border-radius: 10px; border: 0; cursor: pointer; }
    #connect { background: #3b82f6; color: white; }
    #disconnect { background: #374151; color: white; }
    #status { margin-left: 8px; opacity: 0.85; }
    #log { margin-top: 16px; background: #161925; border-radius: 12px; padding: 12px; height: 340px; overflow: auto; white-space: pre-wrap; }
  </style>
</head>
<body>
  <div class="wrap">
    <h1>Pipecat Browser WebSocket Test</h1>
    <div class="row">
      <button id="connect">Connect</button>
      <button id="disconnect">Disconnect</button>
      <span id="status">idle</span>
    </div>
    <div id="log"></div>
  </div>
  <script>
    const logEl = document.getElementById("log");
    const statusEl = document.getElementById("status");
    const log = (...args) => {
      const line = args.map(x => typeof x === "string" ? x : JSON.stringify(x)).join(" ");
      logEl.textContent += line + "\\n";
      logEl.scrollTop = logEl.scrollHeight;
      console.log(...args);
    };

    let ws = null;
    let audioContext = null;
    let mediaStream = null;
    let sourceNode = null;
    let processorNode = null;
    let outputNode = null;
    let outputQueue = [];
    let connected = false;

    function setStatus(v) { statusEl.textContent = v; }

    function downsampleBuffer(buffer, inputRate, outputRate) {
      if (outputRate === inputRate) return buffer;
      const ratio = inputRate / outputRate;
      const newLength = Math.round(buffer.length / ratio);
      const result = new Float32Array(newLength);
      let offsetResult = 0;
      let offsetBuffer = 0;
      while (offsetResult < result.length) {
        const nextOffsetBuffer = Math.round((offsetResult + 1) * ratio);
        let accum = 0, count = 0;
        for (let i = offsetBuffer; i < nextOffsetBuffer && i < buffer.length; i++) {
          accum += buffer[i];
          count++;
        }
        result[offsetResult] = accum / count;
        offsetResult++;
        offsetBuffer = nextOffsetBuffer;
      }
      return result;
    }

    function floatTo16BitPCM(float32Array) {
      const buffer = new ArrayBuffer(float32Array.length * 2);
      const view = new DataView(buffer);
      for (let i = 0; i < float32Array.length; i++) {
        let s = Math.max(-1, Math.min(1, float32Array[i]));
        view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      }
      return buffer;
    }

    function int16ToFloat32(int16Array) {
      const out = new Float32Array(int16Array.length);
      for (let i = 0; i < int16Array.length; i++) out[i] = int16Array[i] / 32768;
      return out;
    }

    function setupPlayback(ctx) {
      outputNode = ctx.createScriptProcessor(4096, 1, 1);
      outputNode.onaudioprocess = (event) => {
        const out = event.outputBuffer.getChannelData(0);
        out.fill(0);
        let offset = 0;
        while (offset < out.length && outputQueue.length > 0) {
          const chunk = outputQueue[0];
          const copy = Math.min(chunk.length, out.length - offset);
          out.set(chunk.subarray(0, copy), offset);
          offset += copy;
          if (copy < chunk.length) {
            outputQueue[0] = chunk.subarray(copy);
          } else {
            outputQueue.shift();
          }
        }
      };
      outputNode.connect(ctx.destination);
    }

    async function connect() {
      if (connected) return;
      setStatus("requesting mic");
      audioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 24000 });
      setupPlayback(audioContext);
      mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      sourceNode = audioContext.createMediaStreamSource(mediaStream);
      processorNode = audioContext.createScriptProcessor(4096, 1, 1);
      processorNode.onaudioprocess = (event) => {
        if (!ws || ws.readyState !== WebSocket.OPEN) return;
        const input = event.inputBuffer.getChannelData(0);
        const downsampled = downsampleBuffer(input, audioContext.sampleRate, 16000);
        ws.send(floatTo16BitPCM(downsampled));
      };
      sourceNode.connect(processorNode);
      processorNode.connect(audioContext.destination);

      const proto = location.protocol === "https:" ? "wss" : "ws";
      ws = new WebSocket(`${proto}://${location.host}/ws/browser`);
      ws.binaryType = "arraybuffer";

      ws.onopen = () => {
        connected = true;
        setStatus("connected");
        log("socket open");
      };
      ws.onclose = () => {
        connected = false;
        setStatus("closed");
        log("socket closed");
      };
      ws.onerror = (e) => {
        setStatus("error");
        log("socket error", e.type || "error");
      };
      ws.onmessage = (event) => {
        if (typeof event.data === "string") {
          log("message", event.data);
          return;
        }
        const int16 = new Int16Array(event.data);
        outputQueue.push(int16ToFloat32(int16));
      };
      setStatus("connecting");
    }

    function disconnect() {
      if (ws) ws.close();
      if (processorNode) processorNode.disconnect();
      if (sourceNode) sourceNode.disconnect();
      if (outputNode) outputNode.disconnect();
      if (mediaStream) mediaStream.getTracks().forEach(t => t.stop());
      if (audioContext) audioContext.close();
      ws = null;
      processorNode = null;
      sourceNode = null;
      outputNode = null;
      mediaStream = null;
      audioContext = null;
      outputQueue = [];
      connected = false;
      setStatus("idle");
    }

    document.getElementById("connect").onclick = connect;
    document.getElementById("disconnect").onclick = disconnect;
  </script>
</body>
</html>"""


def create_browser_transport(websocket: WebSocket) -> BrowserWebsocketTransport:
    return BrowserWebsocketTransport(
        websocket=websocket,
        params=FastAPIWebsocketParams(
            audio_in_enabled=True,
            audio_out_enabled=True,
            audio_in_sample_rate=BROWSER_INPUT_SAMPLE_RATE,
            audio_out_sample_rate=AUDIO_OUTPUT_SAMPLE_RATE,
            serializer=RawPCMFrameSerializer(input_sample_rate=BROWSER_INPUT_SAMPLE_RATE),
        ),
    )


def create_esp32_transport(websocket: WebSocket) -> Esp32WebsocketTransport:
    return Esp32WebsocketTransport(
        websocket=websocket,
        params=FastAPIWebsocketParams(
            audio_in_enabled=True,
            audio_out_enabled=True,
            audio_in_sample_rate=ESP32_INPUT_SAMPLE_RATE,
            audio_out_sample_rate=AUDIO_OUTPUT_SAMPLE_RATE,
            serializer=RawPCMFrameSerializer(input_sample_rate=ESP32_INPUT_SAMPLE_RATE),
        ),
    )


def create_app() -> FastAPI:
    app = FastAPI()
    allow_all_origins = ALLOWED_ORIGINS == ["*"]
    app.add_middleware(
        CORSMiddleware,
        allow_origins=ALLOWED_ORIGINS if not allow_all_origins else ["*"],
        allow_credentials=not allow_all_origins,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.get("/", include_in_schema=False)
    async def root_redirect():
        return RedirectResponse(url="/browser")

    @app.get("/browser", response_class=HTMLResponse)
    async def browser_page():
        return HTMLResponse(BROWSER_HTML)

    @app.get("/healthz")
    async def healthcheck():
        return {"ok": True}

    @app.get("/providers")
    async def providers_catalog():
        return get_provider_catalog()

    @app.on_event("startup")
    async def validate_provider_configuration():
        selected = validate_classic_provider_stack()
        logger.info(
            "Classic provider stack validated: stt={} llm={} tts={}",
            selected["stt"],
            selected["llm"],
            selected["tts"],
        )

    @app.websocket("/ws/browser")
    async def browser_websocket(websocket: WebSocket):
        await websocket.accept()
        logger.info("Browser websocket connected")
        transport = create_browser_transport(websocket)
        await run_bot_session(transport, "browser", False)

    @app.websocket("/ws/nextjs")
    async def nextjs_websocket(websocket: WebSocket):
        await websocket.accept()
        logger.info("NextJS websocket connected")
        transport = create_browser_transport(websocket)
        await run_bot_session(transport, "browser", False)

    @app.websocket("/ws/esp32")
    async def esp32_websocket(websocket: WebSocket):
        await websocket.accept()
        logger.info(
            "ESP32 websocket connected: mac={} rssi={} auth={}",
            websocket.headers.get("x-device-mac", "unknown"),
            websocket.headers.get("x-wifi-rssi", "unknown"),
            "yes" if websocket.headers.get("authorization") else "no",
        )
        await websocket.send_text(json.dumps(create_esp32_auth_message()))
        transport = create_esp32_transport(websocket)
        await run_bot_session(transport, "esp32", False)

    return app


app = create_app()


if __name__ == "__main__":
    uvicorn.run("server:app", host=HOST, port=PORT, reload=False)

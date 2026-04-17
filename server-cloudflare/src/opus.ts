import opusWasm from "./vendor/opus.wasm";

const SAMPLE_RATE = 24_000;
const CHANNELS = 1;
const FRAME_DURATION_MS = 120;
const BYTES_PER_SAMPLE = 2;
const FRAME_SIZE_BYTES =
  (SAMPLE_RATE * FRAME_DURATION_MS / 1000) * CHANNELS * BYTES_PER_SAMPLE;
const MAX_PACKET_SIZE = 2 ** 13;
const PCM_BUFFER_SIZE = 2 ** 15;

interface OpusExports {
  memory: WebAssembly.Memory;
  malloc(size: number): number;
  free(ptr: number): void;
  opus_strerror(code: number): number;
  opus_encoder_get_size(channels: number): number;
  opus_encoder_init(
    ptr: number,
    sampleRate: number,
    channels: number,
    application: number,
  ): number;
  opus_encoder_ctl_get(ptr: number, cmd: number): number;
  opus_encoder_ctl_set(ptr: number, cmd: number, arg: number): number;
  opus_encode(
    ptr: number,
    pcmPtr: number,
    frameSize: number,
    packetPtr: number,
    maxPacketSize: number,
  ): number;
}

const decoder = new TextDecoder();

const wasmInstancePromise = WebAssembly.instantiate(opusWasm, {
  wasi_snapshot_preview1: {
    fd_seek() {},
    fd_write() {},
    fd_close() {},
    proc_exit() {},
  },
  env: {
    emscripten_notify_memory_growth() {},
  },
});

function loadCString(memory: Uint8Array, ptr: number): string {
  let end = ptr;
  while (end < memory.length && memory[end] !== 0) {
    end += 1;
  }
  return decoder.decode(memory.subarray(ptr, end));
}

function ensureOk(code: number, memory: Uint8Array, wasm: OpusExports): number {
  if (code >= 0) {
    return code;
  }
  throw new Error(`opus: ${loadCString(memory, wasm.opus_strerror(code))}`);
}

class WasmOpusEncoder {
  private readonly wasm: OpusExports;
  private memory: Uint8Array;
  private readonly pcmPtr: number;
  private readonly packetPtr: number;
  private readonly encoderPtr: number;
  private closed = false;

  constructor(wasm: OpusExports) {
    this.wasm = wasm;
    this.memory = new Uint8Array(wasm.memory.buffer);
    this.packetPtr = wasm.malloc(MAX_PACKET_SIZE);
    this.pcmPtr = wasm.malloc(PCM_BUFFER_SIZE);
    this.encoderPtr = wasm.malloc(wasm.opus_encoder_get_size(CHANNELS));

    ensureOk(
      wasm.opus_encoder_init(this.encoderPtr, SAMPLE_RATE, CHANNELS, 2048),
      this.memory,
      wasm,
    );

    // The 120ms packet duration is determined by the PCM frame size we pass to
    // opus_encode(). Avoid low-level CTL tuning here because incorrect request
    // codes/enum values in the wasm build surface as "invalid argument" during
    // session startup.
  }

  private refreshMemory() {
    if (this.memory.buffer !== this.wasm.memory.buffer) {
      this.memory = new Uint8Array(this.wasm.memory.buffer);
    }
  }

  encode(frame: Uint8Array): Uint8Array {
    if (this.closed) {
      throw new Error("Opus encoder is closed");
    }

    this.refreshMemory();
    this.memory.set(frame, this.pcmPtr);
    const size = ensureOk(
      this.wasm.opus_encode(
        this.encoderPtr,
        this.pcmPtr,
        frame.byteLength / BYTES_PER_SAMPLE / CHANNELS,
        this.packetPtr,
        MAX_PACKET_SIZE,
      ),
      this.memory,
      this.wasm,
    );

    this.refreshMemory();
    return this.memory.slice(this.packetPtr, this.packetPtr + size);
  }

  close() {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.wasm.free(this.encoderPtr);
    this.wasm.free(this.pcmPtr);
    this.wasm.free(this.packetPtr);
  }
}

let encoderFactoryPromise: Promise<() => WasmOpusEncoder> | undefined;

async function getEncoderFactory(): Promise<() => WasmOpusEncoder> {
  if (!encoderFactoryPromise) {
    encoderFactoryPromise = wasmInstancePromise.then((instance) => {
      const wasm = instance.exports as unknown as OpusExports;
      return () => new WasmOpusEncoder(wasm);
    });
  }

  return encoderFactoryPromise;
}

function concatBytes(left: Uint8Array, right: Uint8Array): Uint8Array {
  const out = new Uint8Array(left.length + right.length);
  out.set(left, 0);
  out.set(right, left.length);
  return out;
}

export async function createOpusPacketizer(
  sendPacket: (packet: Uint8Array) => void,
) {
  const createEncoder = await getEncoderFactory();
  const encoder = createEncoder();
  let pending: Uint8Array<ArrayBufferLike> = new Uint8Array(0);
  let closed = false;

  const push = (pcm: Uint8Array) => {
    if (closed || pcm.byteLength === 0) {
      return;
    }

    pending = concatBytes(pending, pcm);
    while (pending.byteLength >= FRAME_SIZE_BYTES) {
      const frame = pending.slice(0, FRAME_SIZE_BYTES);
      pending = pending.slice(FRAME_SIZE_BYTES);
      sendPacket(encoder.encode(frame));
    }
  };

  const flush = (padFinalFrame = false) => {
    if (closed || pending.byteLength === 0) {
      return;
    }

    if (!padFinalFrame) {
      pending = new Uint8Array(0);
      return;
    }

    const padded = new Uint8Array(FRAME_SIZE_BYTES);
    padded.set(pending, 0);
    pending = new Uint8Array(0);
    sendPacket(encoder.encode(padded));
  };

  const reset = () => {
    pending = new Uint8Array(0);
  };

  const close = () => {
    if (closed) {
      return;
    }
    closed = true;
    pending = new Uint8Array(0);
    encoder.close();
  };

  const bufferedBytes = () => pending.byteLength;

  return {
    push,
    flush,
    reset,
    close,
    bufferedBytes,
  };
}

export {
  SAMPLE_RATE as OPUS_SAMPLE_RATE,
  FRAME_SIZE_BYTES as OPUS_FRAME_SIZE_BYTES,
};

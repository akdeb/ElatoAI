"""Custom websocket transports for raw PCM input with ESP32/browser outputs."""

from __future__ import annotations

import json
from dataclasses import dataclass

import av
import numpy as np
from fastapi import WebSocket
from loguru import logger

from pipecat.frames.frames import (
    Frame,
    InputAudioRawFrame,
    InputTransportMessageFrame,
    OutputAudioRawFrame,
    OutputTransportMessageFrame,
    OutputTransportMessageUrgentFrame,
)
from pipecat.serializers.base_serializer import FrameSerializer
from pipecat.transports.websocket.fastapi import (
    FastAPIWebsocketCallbacks,
    FastAPIWebsocketClient,
    FastAPIWebsocketInputTransport,
    FastAPIWebsocketOutputTransport,
    FastAPIWebsocketParams,
    FastAPIWebsocketTransport,
)


class RawPCMFrameSerializer(FrameSerializer):
    """Deserialize raw PCM and JSON control messages."""

    def __init__(self, input_sample_rate: int, input_channels: int = 1):
        super().__init__()
        self._input_sample_rate = input_sample_rate
        self._input_channels = input_channels

    async def serialize(self, frame: Frame) -> str | bytes | None:
        if isinstance(frame, (OutputTransportMessageFrame, OutputTransportMessageUrgentFrame)):
            if self.should_ignore_frame(frame):
                return None
            return json.dumps(frame.message)
        return None

    async def deserialize(self, data: str | bytes) -> Frame | None:
        if isinstance(data, bytes):
            return InputAudioRawFrame(
                audio=data,
                sample_rate=self._input_sample_rate,
                num_channels=self._input_channels,
            )

        if isinstance(data, str):
            try:
                message = json.loads(data)
            except json.JSONDecodeError:
                logger.warning("Ignoring non-JSON websocket text frame")
                return None
            return InputTransportMessageFrame(message=message)

        return None


@dataclass
class OpusEncoder:
    sample_rate: int = 24000
    channels: int = 1
    bit_rate: int = 24000
    frame_duration_ms: int = 120

    def __post_init__(self):
        self._codec = av.CodecContext.create("libopus", "w")
        self._codec.sample_rate = self.sample_rate
        self._codec.rate = self.sample_rate
        self._codec.layout = "mono" if self.channels == 1 else "stereo"
        self._codec.format = "s16"
        self._codec.bit_rate = self.bit_rate
        self._codec.options = {
            "application": "voip",
            "frame_duration": str(self.frame_duration_ms),
        }
        self._codec.open()
        self._frame_size = int(self.sample_rate * self.frame_duration_ms / 1000)
        self._bytes_per_frame = self._frame_size * self.channels * 2
        self._buffer = bytearray()

    def encode(self, pcm_audio: bytes) -> list[bytes]:
        packets: list[bytes] = []
        self._buffer.extend(pcm_audio)

        while len(self._buffer) >= self._bytes_per_frame:
            chunk = bytes(self._buffer[: self._bytes_per_frame])
            del self._buffer[: self._bytes_per_frame]

            samples = np.frombuffer(chunk, dtype=np.int16).reshape(self.channels, -1)
            frame = av.AudioFrame.from_ndarray(samples, format="s16", layout=self._codec.layout.name)
            frame.sample_rate = self.sample_rate
            packets.extend(bytes(packet) for packet in self._codec.encode(frame))

        return packets

    def flush(self, pad_final_frame: bool = False) -> list[bytes]:
        if not self._buffer:
            return []

        if not pad_final_frame:
            self._buffer.clear()
            return []

        padded = bytes(self._buffer) + b"\x00" * (self._bytes_per_frame - len(self._buffer))
        self._buffer.clear()
        return self.encode(padded)

    def reset(self):
        self._buffer.clear()

    def close(self):
        self._buffer.clear()


class RawPCMWebsocketOutputTransport(FastAPIWebsocketOutputTransport):
    async def send_message(
        self, frame: OutputTransportMessageFrame | OutputTransportMessageUrgentFrame
    ):
        if self._client.is_closing or not self._client.is_connected:
            return
        payload = await self._params.serializer.serialize(frame) if self._params.serializer else None
        if payload:
            await self._client.send(payload)

    async def write_audio_frame(self, frame: OutputAudioRawFrame) -> bool:
        if self._client.is_closing or not self._client.is_connected:
            return False

        await self._client.send(frame.audio)
        await self._write_audio_sleep()
        return True


class OpusWebsocketOutputTransport(FastAPIWebsocketOutputTransport):
    def __init__(self, transport, client, params, **kwargs):
        super().__init__(transport, client, params, **kwargs)
        self._encoder = OpusEncoder(
            sample_rate=params.audio_out_sample_rate or 24000,
            channels=params.audio_out_channels or 1,
            bit_rate=24000,
        )

    async def send_message(
        self, frame: OutputTransportMessageFrame | OutputTransportMessageUrgentFrame
    ):
        if self._client.is_closing or not self._client.is_connected:
            return

        message = frame.message if isinstance(frame.message, dict) else {}
        msg = message.get("msg")

        if msg == "RESPONSE.CREATED":
            self._encoder.reset()
        elif msg == "RESPONSE.COMPLETE":
            for packet in self._encoder.flush(pad_final_frame=True):
                await self._client.send(packet)
        elif msg == "RESPONSE.ERROR":
            self._encoder.reset()

        payload = await self._params.serializer.serialize(frame) if self._params.serializer else None
        if payload:
            await self._client.send(payload)

    async def write_audio_frame(self, frame: OutputAudioRawFrame) -> bool:
        if self._client.is_closing or not self._client.is_connected:
            return False

        for packet in self._encoder.encode(frame.audio):
            await self._client.send(packet)

        await self._write_audio_sleep()
        return True


class BaseRawWebsocketTransport(FastAPIWebsocketTransport):
    output_transport_cls = RawPCMWebsocketOutputTransport

    def __init__(
        self,
        websocket: WebSocket,
        params: FastAPIWebsocketParams,
        input_name: str | None = None,
        output_name: str | None = None,
    ):
        super(FastAPIWebsocketTransport, self).__init__(input_name=input_name, output_name=output_name)
        self._params = params
        self._callbacks = FastAPIWebsocketCallbacks(
            on_client_connected=self._on_client_connected,
            on_client_disconnected=self._on_client_disconnected,
            on_session_timeout=self._on_session_timeout,
        )
        self._client = FastAPIWebsocketClient(websocket, self._callbacks)
        self._input = FastAPIWebsocketInputTransport(
            self, self._client, self._params, name=self._input_name
        )
        self._output = self.output_transport_cls(self, self._client, self._params, name=self._output_name)
        self._register_event_handler("on_client_connected")
        self._register_event_handler("on_client_disconnected")
        self._register_event_handler("on_session_timeout")


class Esp32WebsocketTransport(BaseRawWebsocketTransport):
    output_transport_cls = OpusWebsocketOutputTransport


class BrowserWebsocketTransport(BaseRawWebsocketTransport):
    output_transport_cls = RawPCMWebsocketOutputTransport

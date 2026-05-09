#
# Copyright (c) 2024-2026, Daily
#
# SPDX-License-Identifier: BSD 2-Clause License
#

"""Shared Pipecat bot logic for the local multi-transport server."""

import os
from typing import Literal

from voice_pipeline import build_voice_pipeline
from dotenv import load_dotenv
from gem_live_route import build_gem_live_route
from grok_route import build_grok_route
from loguru import logger

logger.info("Loading Silero VAD model...")

logger.info("Silero VAD model loaded")

from pipecat.frames.frames import (
    BotStartedSpeakingFrame,
    BotStoppedSpeakingFrame,
    EmulateUserStoppedSpeakingFrame,
    ErrorFrame,
    Frame,
    InputTransportMessageFrame,
    InterruptionFrame,
    LLMContextFrame,
    LLMRunFrame,
    OutputAudioRawFrame,
    OutputTransportMessageFrame,
    STTMuteFrame,
    TTSStoppedFrame,
    UserStoppedSpeakingFrame,
    VADUserStoppedSpeakingFrame,
)
from pipecat.pipeline.pipeline import Pipeline
from pipecat.pipeline.runner import PipelineRunner
from pipecat.pipeline.task import PipelineParams, PipelineTask
from pipecat.processors.aggregators.llm_context import LLMContext
from pipecat.processors.frame_processor import FrameDirection, FrameProcessor
from pipecat.transports.base_transport import BaseTransport

logger.info("All components loaded successfully")

load_dotenv(override=True)
CURRENT_VOICE_ROUTE = os.getenv("CURRENT_VOICE_ROUTE", "classic").strip().lower()
AUDIO_IN_SAMPLE_RATE = int(os.getenv("PIPELINE_AUDIO_IN_SAMPLE_RATE", "16000"))
AUDIO_OUT_SAMPLE_RATE = int(os.getenv("PIPELINE_AUDIO_OUT_SAMPLE_RATE", "24000"))


class RealtimeInputControlProcessor(FrameProcessor):
    """Bridge incoming websocket control messages into Pipecat frames."""

    def __init__(self, voice_route: str):
        super().__init__()
        self._voice_route = voice_route

    async def process_frame(self, frame: Frame, direction: FrameDirection):
        await super().process_frame(frame, direction)

        if isinstance(frame, InputTransportMessageFrame):
            message = frame.message if isinstance(frame.message, dict) else {}
            msg_type = message.get("type")
            msg = message.get("msg")

            if msg_type == "instruction" and msg == "end_of_speech":
                if self._voice_route == "gem_live":
                    await self.push_frame(VADUserStoppedSpeakingFrame(), FrameDirection.DOWNSTREAM)
                else:
                    await self.push_frame(
                        EmulateUserStoppedSpeakingFrame(), FrameDirection.DOWNSTREAM
                    )
                    await self.push_frame(STTMuteFrame(mute=True), FrameDirection.DOWNSTREAM)
                return

            if msg_type == "instruction" and msg == "INTERRUPT":
                await self.push_frame(InterruptionFrame(), FrameDirection.DOWNSTREAM)
                if self._voice_route != "gem_live":
                    await self.push_frame(STTMuteFrame(mute=False), FrameDirection.DOWNSTREAM)
                return

        await self.push_frame(frame, direction)


class RealtimeOutputControlProcessor(FrameProcessor):
    """Translate pipeline state changes into the old websocket control protocol."""

    def __init__(self):
        super().__init__()
        self._response_started = False

    async def process_frame(self, frame: Frame, direction: FrameDirection):
        await super().process_frame(frame, direction)

        if direction is FrameDirection.DOWNSTREAM:
            if isinstance(frame, (UserStoppedSpeakingFrame, VADUserStoppedSpeakingFrame)):
                await self.push_frame(
                    OutputTransportMessageFrame(message={"type": "server", "msg": "AUDIO.COMMITTED"}),
                    direction,
                )
            elif isinstance(frame, OutputAudioRawFrame) and not self._response_started:
                self._response_started = True
                logger.debug("Sending RESPONSE.CREATED before first audio packet")
                await self.push_frame(STTMuteFrame(mute=True), direction)
                await self.push_frame(
                    OutputTransportMessageFrame(message={"type": "server", "msg": "RESPONSE.CREATED"}),
                    direction,
                )
            elif isinstance(frame, (TTSStoppedFrame, BotStoppedSpeakingFrame)):
                self._response_started = False
                logger.debug("Sending RESPONSE.COMPLETE after TTS stop")
                await self.push_frame(STTMuteFrame(mute=False), direction)
                await self.push_frame(frame, direction)
                await self.push_frame(
                    OutputTransportMessageFrame(message={"type": "server", "msg": "RESPONSE.COMPLETE"}),
                    direction,
                )
                return
            elif isinstance(frame, ErrorFrame):
                self._response_started = False
                await self.push_frame(STTMuteFrame(mute=False), direction)
                await self.push_frame(
                    OutputTransportMessageFrame(message={"type": "server", "msg": "RESPONSE.ERROR"}),
                    direction,
                )

        await self.push_frame(frame, direction)


def create_esp32_auth_message() -> dict:
    return {
        "type": "auth",
        "volume_control": int(os.getenv("ESP32_DEFAULT_VOLUME", "100")),
        "pitch_factor": float(os.getenv("ESP32_DEFAULT_PITCH_FACTOR", "1.0")),
        "is_ota": False,
        "is_reset": False,
    }


async def run_bot_session(
    transport: BaseTransport,
    transport_kind: Literal["browser", "esp32"],
    handle_sigint: bool = False,
):
    voice_route = CURRENT_VOICE_ROUTE
    logger.info(f"Starting bot session for {transport_kind} via route={voice_route}")

    context = LLMContext()
    input_processor = RealtimeInputControlProcessor(voice_route)
    if voice_route == "gem_live":
        route_processors, assistant_aggregator = build_gem_live_route(input_processor, context)
    elif voice_route == "grok":
        route_processors, assistant_aggregator = build_grok_route(input_processor, context)
    else:
        route_processors, assistant_aggregator = build_voice_pipeline(input_processor, context)

    processors = [transport.input(), *route_processors]

    if transport_kind in {"esp32", "browser"}:
        processors.append(RealtimeOutputControlProcessor())
    processors.append(transport.output())
    processors.append(assistant_aggregator)

    pipeline = Pipeline(processors)

    task = PipelineTask(
        pipeline,
        params=PipelineParams(
            enable_metrics=True,
            enable_usage_metrics=True,
            audio_in_sample_rate=AUDIO_IN_SAMPLE_RATE,
            audio_out_sample_rate=AUDIO_OUT_SAMPLE_RATE,
        ),
    )

    @transport.event_handler("on_client_connected")
    async def on_client_connected(transport, client):
        logger.info(f"{transport_kind} client connected")
        if voice_route in {"gem_live", "grok"}:
            context.add_message(
                {
                    "role": "user",
                    "content": "Say hello and briefly introduce yourself.",
                }
            )
            await task.queue_frames(
                [
                    LLMContextFrame(context=context)
                ]
            )
        else:
            context.add_message(
                {
                    "role": "developer",
                    "content": "Say hello and briefly introduce yourself.",
                }
            )
            await task.queue_frames([LLMRunFrame()])

    @transport.event_handler("on_client_disconnected")
    async def on_client_disconnected(transport, client):
        logger.info(f"{transport_kind} client disconnected")
        await task.cancel()

    runner = PipelineRunner(handle_sigint=handle_sigint)
    await runner.run(task)

"""Grok Realtime native speech-to-speech pipeline builder."""

from __future__ import annotations

import os

from character_prompt import LANGUAGE_LEARNING_PAL_PROMPT
from pipecat.processors.aggregators.llm_context import LLMContext
from pipecat.processors.aggregators.llm_response_universal import LLMContextAggregatorPair


def build_grok_route(input_processor, context: LLMContext):
    try:
        from pipecat.services.xai.realtime.events import (
            AudioConfiguration,
            AudioInput,
            AudioOutput,
            PCMAudioFormat,
            SessionProperties,
            TurnDetection,
        )
        from pipecat.services.xai.realtime.llm import GrokRealtimeLLMService
    except Exception as exc:
        raise RuntimeError(
            "Grok route requires pipecat-ai[grok]. Add the grok extra and redeploy."
        ) from exc

    api_key = os.getenv("XAI_API_KEY")
    if not api_key:
        raise RuntimeError("Grok route requires XAI_API_KEY.")

    voice = os.getenv("GROK_VOICE", "Ara")

    llm = GrokRealtimeLLMService(
        api_key=api_key,
        settings=GrokRealtimeLLMService.Settings(
            session_properties=SessionProperties(
                instructions=(
                LANGUAGE_LEARNING_PAL_PROMPT
                ),
                voice=voice,
                turn_detection=TurnDetection(type="server_vad"),
                audio=AudioConfiguration(
                    input=AudioInput(format=PCMAudioFormat(rate=16000)),
                    output=AudioOutput(format=PCMAudioFormat(rate=24000)),
                ),
            ),
        ),
    )

    user_aggregator, assistant_aggregator = LLMContextAggregatorPair(context)
    processors = [
        input_processor,
        user_aggregator,
        llm,
    ]

    return processors, assistant_aggregator

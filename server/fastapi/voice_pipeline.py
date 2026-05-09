"""Default STT -> LLM -> TTS voice pipeline builder."""

from __future__ import annotations

import os

from character_prompt import LANGUAGE_LEARNING_PAL_PROMPT
from loguru import logger
from models.llm import create_llm_service
from models.stt import create_stt_service
from models.tts import create_tts_service
from pipecat.audio.vad.silero import SileroVADAnalyzer
from pipecat.audio.vad.vad_analyzer import VADParams
from pipecat.processors.aggregators.llm_context import LLMContext
from pipecat.processors.aggregators.llm_response_universal import (
    LLMContextAggregatorPair,
    LLMUserAggregatorParams,
)


def build_voice_pipeline(input_processor, context: LLMContext):
    stt_provider = os.getenv("CLASSIC_STT_PROVIDER", "deepgram")
    llm_provider = os.getenv("CLASSIC_LLM_PROVIDER", "openai")
    tts_provider = os.getenv("CLASSIC_TTS_PROVIDER", "elevenlabs")

    logger.info(
        "Building classic route with stt={} llm={} tts={}",
        stt_provider,
        llm_provider,
        tts_provider,
    )

    stt = create_stt_service(stt_provider)
    llm = create_llm_service(
        llm_provider,
        system_instruction=LANGUAGE_LEARNING_PAL_PROMPT,
    )
    tts = create_tts_service(tts_provider)

    user_aggregator, assistant_aggregator = LLMContextAggregatorPair(
        context,
        user_params=LLMUserAggregatorParams(
            vad_analyzer=SileroVADAnalyzer(params=VADParams(stop_secs=1))
        ),
    )

    processors = [
        input_processor,
        stt,
        user_aggregator,
        llm,
        tts,
    ]

    return processors, assistant_aggregator

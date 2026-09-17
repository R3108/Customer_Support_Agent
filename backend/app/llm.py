"""LLM provider resolution.

Relay runs in two modes:
* **LLM mode** – Anthropic Claude or OpenAI models with structured outputs.
* **Offline mode** – a deterministic rules + retrieval engine, used when no API key is
  configured or when a provider call fails. This keeps demos, tests and CI free and
  makes the product degrade gracefully during provider outages.
"""

from __future__ import annotations

import logging
from functools import lru_cache
from typing import Any, TypeVar

from langchain_core.language_models import BaseChatModel
from langchain_core.messages import BaseMessage
from pydantic import BaseModel

from .config import get_settings

log = logging.getLogger("relay.llm")
T = TypeVar("T", bound=BaseModel)


def resolve_provider() -> str:
    s = get_settings()
    provider = s.llm_provider.lower()
    if provider == "auto":
        if s.anthropic_api_key:
            return "anthropic"
        if s.openai_api_key:
            return "openai"
        return "offline"
    if provider == "anthropic" and not s.anthropic_api_key:
        log.warning("RELAY_LLM_PROVIDER=anthropic but no ANTHROPIC_API_KEY set; using offline mode")
        return "offline"
    if provider == "openai" and not s.openai_api_key:
        log.warning("RELAY_LLM_PROVIDER=openai but no OPENAI_API_KEY set; using offline mode")
        return "offline"
    return provider


def model_name() -> str | None:
    provider = resolve_provider()
    s = get_settings()
    return {"anthropic": s.anthropic_model, "openai": s.openai_model}.get(provider)


@lru_cache
def get_chat_model() -> BaseChatModel | None:
    s = get_settings()
    provider = resolve_provider()
    if provider == "anthropic":
        from langchain_anthropic import ChatAnthropic

        return ChatAnthropic(
            model=s.anthropic_model,
            api_key=s.anthropic_api_key,
            max_tokens=1500,
            timeout=s.llm_timeout_seconds,
            max_retries=2,
        )
    if provider == "openai":
        from langchain_openai import ChatOpenAI

        return ChatOpenAI(
            model=s.openai_model,
            api_key=s.openai_api_key,
            temperature=0,
            timeout=s.llm_timeout_seconds,
            max_retries=2,
        )
    return None


def structured_call(schema: type[T], messages: list[BaseMessage | tuple[str, str]]) -> T | None:
    """Invoke the configured model with a structured-output schema.

    Returns ``None`` in offline mode or when the provider call fails, so callers can
    fall back to the deterministic engine.
    """
    model = get_chat_model()
    if model is None:
        return None
    try:
        result: Any = model.with_structured_output(schema).invoke(messages)
        if isinstance(result, dict):
            result = schema.model_validate(result)
        return result
    except Exception as exc:  # noqa: BLE001 - any provider failure degrades to offline mode
        log.warning("LLM structured call for %s failed, falling back to offline engine: %s", schema.__name__, exc)
        return None

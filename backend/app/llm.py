"""LLM provider resolution.

Relay runs in two modes:
* **LLM mode** – Anthropic Claude or OpenAI models with structured outputs.
* **Offline mode** – a deterministic rules + retrieval engine, used when no API key is
  configured or when a provider call fails. This keeps demos, tests and CI free and
  makes the product degrade gracefully during provider outages.
"""

from __future__ import annotations

import contextvars
import logging
import threading
import time
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import asdict, dataclass
from functools import lru_cache
from typing import Any, TypeVar

from langchain_core.language_models import BaseChatModel
from langchain_core.messages import BaseMessage
from pydantic import BaseModel

from .config import get_settings
from .observability import LLM_CALLS, LLM_TOKENS

log = logging.getLogger("relay.llm")
T = TypeVar("T", bound=BaseModel)


# ---------------------------------------------------------------- circuit breaker
class CircuitBreaker:
    """Stops calling a failing provider for a cooldown, then lets one trial call through (half-open).

    Without it, every turn during an outage waits for the timeout × retries before falling back. With it, the
    offline engine answers instantly until the provider recovers.
    """

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._failures = 0
        self._opened_at: float | None = None
        self._trial_in_flight = False

    @property
    def state(self) -> str:
        with self._lock:
            return self._state()

    def _state(self) -> str:
        if self._opened_at is None:
            return "closed"
        if time.monotonic() - self._opened_at >= get_settings().llm_circuit_cooldown_seconds:
            return "half_open"
        return "open"

    def allow(self) -> bool:
        with self._lock:
            state = self._state()
            if state == "closed":
                return True
            if state == "half_open" and not self._trial_in_flight:
                self._trial_in_flight = True
                return True
            return False

    def success(self) -> None:
        with self._lock:
            if self._opened_at is not None:
                log.info("LLM provider recovered; circuit closed")
            self._failures, self._opened_at, self._trial_in_flight = 0, None, False

    def failure(self) -> None:
        with self._lock:
            self._failures += 1
            reopen = self._trial_in_flight
            self._trial_in_flight = False
            if reopen or self._failures >= get_settings().llm_circuit_failure_threshold:
                if self._opened_at is None or reopen:
                    log.warning("LLM circuit opened after %d consecutive failures; using the offline engine for %.0fs",
                                self._failures, get_settings().llm_circuit_cooldown_seconds)
                self._opened_at = time.monotonic()

    def reset(self) -> None:
        with self._lock:
            self._failures, self._opened_at, self._trial_in_flight = 0, None, False


breaker = CircuitBreaker()


# ---------------------------------------------------------------- usage accounting
@dataclass
class Usage:
    llm_calls: int = 0
    input_tokens: int = 0
    output_tokens: int = 0

    @property
    def cost_usd(self) -> float | None:
        s = get_settings()
        if not (s.llm_input_cost_per_mtok or s.llm_output_cost_per_mtok):
            return None
        return round(self.input_tokens / 1e6 * s.llm_input_cost_per_mtok + self.output_tokens / 1e6 * s.llm_output_cost_per_mtok, 6)

    def to_dict(self) -> dict[str, Any]:
        return {**asdict(self), "cost_usd": self.cost_usd}


_usage: contextvars.ContextVar[Usage | None] = contextvars.ContextVar("relay_llm_usage", default=None)


@contextmanager
def track_usage(usage: Usage | None = None) -> Iterator[Usage]:
    """Collect token usage of every model call made inside the block into `usage`.

    Pass the same `Usage` to several blocks to accumulate across them. Don't hold the block open across a
    generator `yield`: streaming responses resume generators in a fresh context copy each step.
    """
    usage = usage or Usage()
    token = _usage.set(usage)
    try:
        yield usage
    finally:
        _usage.reset(token)


def _record_usage(raw: Any) -> None:
    meta = getattr(raw, "usage_metadata", None) or {}
    tokens_in, tokens_out = int(meta.get("input_tokens") or 0), int(meta.get("output_tokens") or 0)
    LLM_TOKENS.inc(tokens_in, direction="input")
    LLM_TOKENS.inc(tokens_out, direction="output")
    if usage := _usage.get():
        usage.llm_calls += 1
        usage.input_tokens += tokens_in
        usage.output_tokens += tokens_out


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

    Returns ``None`` in offline mode, while the circuit breaker is open, or when the provider call
    fails, so callers can fall back to the deterministic engine.
    """
    model = get_chat_model()
    if model is None:
        return None
    if not breaker.allow():
        LLM_CALLS.inc(outcome="short_circuited")
        return None
    try:
        result: Any = model.with_structured_output(schema, include_raw=True).invoke(messages)
    except Exception as exc:  # noqa: BLE001 - any provider failure degrades to offline mode
        breaker.failure()
        LLM_CALLS.inc(outcome="error")
        log.warning("LLM structured call for %s failed, falling back to offline engine: %s", schema.__name__, exc)
        return None
    # The provider answered, so the circuit stays closed even if the output doesn't fit the schema.
    breaker.success()
    _record_usage(result.get("raw"))
    parsed = result.get("parsed")
    try:
        if isinstance(parsed, dict):
            parsed = schema.model_validate(parsed)
        if result.get("parsing_error") or parsed is None:
            raise ValueError(result.get("parsing_error") or "empty structured output")
    except Exception as exc:  # noqa: BLE001
        LLM_CALLS.inc(outcome="invalid_output")
        log.warning("LLM output for %s didn't match the schema, falling back to offline engine: %s", schema.__name__, exc)
        return None
    LLM_CALLS.inc(outcome="ok")
    return parsed

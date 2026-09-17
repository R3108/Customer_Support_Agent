"""Verify the configured LLM provider end to end (makes a few small, real API calls).

    python -m app.llm_check
"""

from __future__ import annotations

import sys
import time

from langchain_core.messages import HumanMessage, SystemMessage

from .agents.escalation_agent import EscalationBrief
from .agents.intent_classifier import IntentResult
from .agents.memory import MemorySummary
from .agents.support_agent import SupportReply
from .config import get_settings
from .llm import get_chat_model, model_name, resolve_provider


def main() -> int:
    settings = get_settings()
    provider = resolve_provider()
    print(f"Provider: {provider} · model: {model_name()}")
    if provider == "offline":
        print("No usable API key found. Set OPENAI_API_KEY in backend/.env (and RELAY_LLM_PROVIDER=openai).")
        return 1

    model = get_chat_model()
    assert model is not None
    prompt = [
        SystemMessage(f"You are a support assistant for {settings.company_name}. Keep answers short."),
        HumanMessage("Customer asks: do you ship to Canada? Knowledge: 'We ship to all 50 US states and Canada.'"),
    ]
    ok = True
    for schema in (IntentResult, SupportReply, EscalationBrief, MemorySummary):
        started = time.perf_counter()
        try:
            # Call the provider directly (not structured_call) so errors surface instead of falling back.
            result = model.with_structured_output(schema).invoke(prompt)
            preview = str(result.model_dump() if hasattr(result, "model_dump") else result)[:110]
            print(f"  ✓ {schema.__name__:<16} {time.perf_counter() - started:5.2f}s  {preview}")
        except Exception as exc:  # noqa: BLE001
            ok = False
            print(f"  ✗ {schema.__name__:<16} {type(exc).__name__}: {exc}")
    print("All structured outputs working — start the API and the UI will show the model in the top bar." if ok else "Some calls failed (see above).")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())

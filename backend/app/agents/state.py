"""Shared LangGraph state for the support workflow."""

from __future__ import annotations

from typing import Annotated, Any, Literal, TypedDict

from langchain_core.messages import AnyMessage
from langgraph.graph.message import add_messages


def merge_entities(old: dict[str, Any] | None, new: dict[str, Any] | None) -> dict[str, Any]:
    """Long-lived entity memory: later values win, list values are unioned (order preserved)."""
    merged = dict(old or {})
    for key, value in (new or {}).items():
        if isinstance(value, list) and isinstance(merged.get(key), list):
            merged[key] = list(dict.fromkeys([*merged[key], *value]))
        elif value is not None:
            merged[key] = value
    return merged


Action = Literal["answer", "clarify", "escalate"]


class SupportState(TypedDict, total=False):
    # ---- conversation memory (persisted across turns by the checkpointer)
    messages: Annotated[list[AnyMessage], add_messages]
    conversation_id: str
    customer_id: str | None
    entities: Annotated[dict[str, Any], merge_entities]
    memory_summary: str
    low_confidence_streak: int

    # ---- per-turn working state (reset at the start of each turn)
    intent: str
    intent_confidence: float
    sentiment: str
    urgency: str
    standalone_query: str
    signals: dict[str, Any]
    retrieved_docs: list[dict[str, Any]]
    retrieval_confidence: float
    account_context: dict[str, Any]
    draft_response: str
    draft_shareable: bool  # False when a guardrail overrode the draft, so it must not reach the customer
    action: Action
    generation_confidence: float
    confidence: float
    confidence_breakdown: dict[str, Any]
    cited_sources: list[str]
    escalate: bool
    escalation_reason: str
    escalation_detail: str
    ticket: dict[str, Any] | None
    final_response: str
    mode: str
    language: str  # ISO 639-1 code of the customer's latest message
    action_proposal: dict[str, Any] | None  # in-policy action offered to the customer this turn
    action_result: dict[str, Any] | None  # action executed (or queued for approval) this turn
    knowledge_gap: bool  # the knowledge base couldn't answer this in-scope question


TURN_RESET: dict[str, Any] = {
    "intent": "",
    "intent_confidence": 0.0,
    "sentiment": "neutral",
    "urgency": "normal",
    "standalone_query": "",
    "signals": {},
    "retrieved_docs": [],
    "retrieval_confidence": 0.0,
    "account_context": {},
    "draft_response": "",
    "draft_shareable": False,
    "action": "answer",
    "generation_confidence": 0.0,
    "confidence": 0.0,
    "confidence_breakdown": {},
    "cited_sources": [],
    "escalate": False,
    "escalation_reason": "",
    "escalation_detail": "",
    "ticket": None,
    "final_response": "",
    "action_proposal": None,
    "action_result": None,
    "knowledge_gap": False,
}

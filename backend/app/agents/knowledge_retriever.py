"""Knowledge Retriever agent.

Grounds the turn in two sources: RAG over the company knowledge base and the
customer's account / order data (with verification).
"""

from __future__ import annotations

from ..rag import get_retriever
from .context import gather_account_context
from .intents import INTENTS
from .memory import last_customer_message
from .state import SupportState


def knowledge_retriever(state: SupportState) -> dict:
    intent = state.get("intent", "general_inquiry")
    meta = INTENTS.get(intent, INTENTS["general_inquiry"])
    query = state.get("standalone_query") or last_customer_message(state.get("messages", []))

    hits = get_retriever().search(query, category_hint=meta["kb_category"])
    retrieval_confidence = hits[0].score if hits else 0.0

    updates: dict = {
        "retrieved_docs": [h.to_dict() for h in hits],
        "retrieval_confidence": round(retrieval_confidence, 3),
    }

    entities = state.get("entities") or {}
    if meta["account"] or entities.get("active_order_id") or state.get("customer_id"):
        account_context, entity_updates = gather_account_context(state)
        updates["account_context"] = account_context
        if entity_updates:
            updates["entities"] = entity_updates
    return updates

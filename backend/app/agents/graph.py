"""LangGraph workflow wiring.

    START → intent_classifier ─┬─(hard trigger)──────────────→ escalation_agent ─┐
                               ├─(yes/no to an offer)→ action_agent ─┬──────────→ memory_manager → END
                               │                                     └(approval)→ escalation_agent
                               ├─(greeting)──→ support_agent ─┬─(ok / offer)─────→ memory_manager
                               └─→ knowledge_retriever ─→ ────┘└─(low conf/policy)→ escalation_agent
"""

from __future__ import annotations

import sqlite3
import threading
from typing import Any

from langgraph.checkpoint.sqlite import SqliteSaver
from langgraph.graph import END, START, StateGraph

from ..config import get_settings
from .action_agent import action_agent
from .escalation_agent import escalation_agent
from .intent_classifier import intent_classifier
from .knowledge_retriever import knowledge_retriever
from .memory import memory_manager
from .state import SupportState

NODE_LABELS = {
    "intent_classifier": "Intent Classifier",
    "knowledge_retriever": "Knowledge Retriever",
    "support_agent": "Support Agent",
    "action_agent": "Action Agent",
    "escalation_agent": "Escalation Agent",
    "memory_manager": "Memory",
}


def route_after_intent(state: SupportState) -> str:
    if state.get("escalate"):
        return "escalation_agent"
    if (state.get("signals") or {}).get("action_confirmation"):
        return "action_agent"
    if state.get("intent") == "greeting":
        return "support_agent"
    return "knowledge_retriever"


def route_after_support(state: SupportState) -> str:
    return "escalation_agent" if state.get("escalate") else "memory_manager"


def build_graph(checkpointer: Any | None = None):
    # Imported here so the support agent module can be patched in tests.
    from .support_agent import support_agent

    builder = StateGraph(SupportState)
    builder.add_node("intent_classifier", intent_classifier)
    builder.add_node("knowledge_retriever", knowledge_retriever)
    builder.add_node("support_agent", support_agent)
    builder.add_node("action_agent", action_agent)
    builder.add_node("escalation_agent", escalation_agent)
    builder.add_node("memory_manager", memory_manager)

    builder.add_edge(START, "intent_classifier")
    builder.add_conditional_edges(
        "intent_classifier",
        route_after_intent,
        {"escalation_agent": "escalation_agent", "action_agent": "action_agent", "support_agent": "support_agent",
         "knowledge_retriever": "knowledge_retriever"},
    )
    builder.add_edge("knowledge_retriever", "support_agent")
    builder.add_conditional_edges(
        "support_agent", route_after_support, {"escalation_agent": "escalation_agent", "memory_manager": "memory_manager"}
    )
    builder.add_conditional_edges(
        "action_agent", route_after_support, {"escalation_agent": "escalation_agent", "memory_manager": "memory_manager"}
    )
    builder.add_edge("escalation_agent", "memory_manager")
    builder.add_edge("memory_manager", END)
    return builder.compile(checkpointer=checkpointer)


_graph = None
_lock = threading.Lock()


def get_graph():
    global _graph
    with _lock:
        if _graph is None:
            path = get_settings().checkpoint_path
            path.parent.mkdir(parents=True, exist_ok=True)
            conn = sqlite3.connect(path, check_same_thread=False)
            _graph = build_graph(SqliteSaver(conn))
        return _graph

"""Conversation-memory helpers and the memory_manager node.

Short-term memory = the last N messages kept verbatim in graph state.
Long-term memory  = a rolling summary of older turns + an entity store (order ids,
verified email, last intent) that survives summarization.
"""

from __future__ import annotations

from langchain_core.messages import AIMessage, AnyMessage, HumanMessage, RemoveMessage, SystemMessage
from pydantic import BaseModel, Field

from ..config import get_settings
from ..llm import structured_call
from .state import SupportState


def speaker(message: AnyMessage) -> str:
    if isinstance(message, HumanMessage):
        return "Customer"
    if isinstance(message, AIMessage):
        return "Specialist" if message.name == "human_agent" else "Assistant"
    return "System"


def transcript(messages: list[AnyMessage], limit: int | None = None) -> str:
    selected = messages[-limit:] if limit else messages
    return "\n".join(f"{speaker(m)}: {m.content}" for m in selected if isinstance(m.content, str))


def last_customer_message(messages: list[AnyMessage]) -> str:
    for m in reversed(messages):
        if isinstance(m, HumanMessage):
            return str(m.content)
    return ""


def previous_customer_message(messages: list[AnyMessage]) -> str:
    seen = 0
    for m in reversed(messages):
        if isinstance(m, HumanMessage):
            seen += 1
            if seen == 2:
                return str(m.content)
    return ""


class MemorySummary(BaseModel):
    summary: str = Field(description="Concise running summary of the conversation so far: customer goals, facts established, resolutions and open issues. Max 120 words.")


def memory_manager(state: SupportState) -> dict:
    settings = get_settings()
    updates: dict = {}
    intent = state.get("intent")
    entities: dict = {}
    if intent and intent not in ("greeting", "general_inquiry"):
        entities["last_intent"] = intent
    # An action offer only stays open for the customer's very next message.
    if (state.get("entities") or {}).get("pending_action") and not state.get("action_proposal"):
        entities["pending_action"] = {}
    if entities:
        updates["entities"] = entities

    messages = state.get("messages", [])
    window = settings.memory_window
    if len(messages) <= window + 4:  # summarize in batches, not every turn
        return updates

    old = messages[:-window]
    previous = state.get("memory_summary", "")
    result = structured_call(
        MemorySummary,
        [
            SystemMessage("You maintain the long-term memory for a customer support conversation."),
            HumanMessage(f"Existing summary:\n{previous or '(none)'}\n\nNew messages to fold in:\n{transcript(old)}"),
        ],
    )
    if result:
        summary = result.summary
    else:
        lines = [line for line in previous.splitlines() if line.strip()]
        for m in old:
            if isinstance(m, HumanMessage):
                lines.append(f"- Customer said: {str(m.content)[:140]}")
            elif isinstance(m, AIMessage) and m.name == "human_agent":
                lines.append(f"- Specialist replied: {str(m.content)[:140]}")
        summary = "\n".join(lines[-10:])

    updates["memory_summary"] = summary
    updates["messages"] = [RemoveMessage(id=m.id) for m in old if m.id]
    return updates

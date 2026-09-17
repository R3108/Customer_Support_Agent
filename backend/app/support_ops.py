"""Operations shared by the chat API and the console: specialist messages and ticket resolution."""

from __future__ import annotations

from typing import Any

from langchain_core.messages import AIMessage

from . import db, webhooks
from .agents.graph import get_graph
from .config import get_settings


def graph_config(conversation_id: str) -> dict[str, Any]:
    return {"configurable": {"thread_id": conversation_id}}


def post_specialist_message(conversation_id: str, content: str, agent_name: str, meta: dict[str, Any] | None = None) -> dict[str, Any]:
    """Show a specialist message in the customer's chat and add it to agent memory."""
    message = db.add_message(conversation_id, "human_agent", content, {"agent_name": agent_name, **(meta or {})})
    get_graph().update_state(
        graph_config(conversation_id), {"messages": [AIMessage(content=content, name="human_agent")]}, as_node="memory_manager"
    )
    return message


def resolve_ticket(ticket_id: str, conversation_id: str, agent_name: str | None = None) -> None:
    db.update_ticket(ticket_id, status="resolved", resolved_at=db.now_iso())
    db.update_conversation(conversation_id, status="resolved")
    db.add_message(
        conversation_id, "system",
        f"{agent_name or 'A specialist'} marked this conversation as resolved. {get_settings().assistant_name} is back to help if you need anything else.",
        {"resolved": True},
    )
    webhooks.emit("ticket.resolved", {"ticket": db.get_ticket(ticket_id), "agent_name": agent_name})

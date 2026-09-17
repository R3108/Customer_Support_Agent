"""Action Agent.

Runs when the customer answers an action the Support Agent offered ("Reply yes to
confirm"). It re-checks ownership and policy at execution time, performs the action
through the commerce layer, and hands anything that needs approval to the Escalation Agent.
"""

from __future__ import annotations

from langchain_core.messages import AIMessage

from .. import actions, commerce
from ..i18n import localize
from .state import SupportState


def action_agent(state: SupportState) -> dict:
    entities = state.get("entities") or {}
    pending = entities.get("pending_action") or {}
    decision = (state.get("signals") or {}).get("action_confirmation")
    language = state.get("language") or "en"
    order_id = pending.get("order_id", "")
    base = {
        "entities": {"pending_action": {}},  # an offer is answered exactly once
        "action": "answer",
        "confidence": 1.0,
        "confidence_breakdown": {"action_confirmation": decision, "action": pending.get("type"), "final": 1.0},
    }

    if decision == "decline":
        text = localize(f"No problem — I've left **{order_id}** as it is. Is there anything else I can help with?", language)
        return {**base, "final_response": text, "messages": [AIMessage(content=text, name="assistant")]}

    order = commerce.get_order(order_id)
    if not order or order["customer_id"] != pending.get("customer_id"):
        text = localize("Sorry — I couldn't confirm that order belongs to you anymore, so I haven't changed anything.", language)
        return {**base, "action": "clarify", "final_response": text, "messages": [AIMessage(content=text, name="assistant")]}

    result = actions.request(
        pending["type"], order_id, requested_by="ai", conversation_id=state.get("conversation_id"),
    )
    summary = {k: result[k] for k in ("id", "type", "label", "status", "order_id", "amount")}
    if result["status"] == "executed":
        text = localize(result["result"]["message"], language)
    elif result["status"] == "pending_approval":
        # Settings changed since the offer (e.g. a lower refund limit): a specialist decides.
        return {
            **base, "action_result": summary, "action": "escalate", "escalate": True, "escalation_reason": "refund_approval",
            "escalation_detail": f"{order_id}: {result['label']} awaiting approval",
        }
    else:
        text = localize(f"I wasn't able to complete that: {result['result'].get('error', 'the order changed')}. "
                        "Would you like me to connect you with a specialist?", language)
    return {**base, "action_result": summary, "final_response": text, "messages": [AIMessage(content=text, name="assistant")]}

"""Escalation Agent.

Hands the conversation to a human: prioritizes, routes to a team, writes a briefing
and a suggested reply for the specialist, opens (or updates) the ticket and tells the
customer what happens next.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from langchain_core.messages import AIMessage, HumanMessage, SystemMessage
from pydantic import BaseModel, Field

from .. import actions, commerce, db, webhooks
from ..config import get_settings
from ..i18n import localize
from ..llm import structured_call
from .context import first_name, gather_account_context
from .intents import INTENTS
from .memory import last_customer_message, transcript
from .state import SupportState

PRIORITIES = ["low", "normal", "high", "urgent"]
SLA_HOURS = {"urgent": 1, "high": 4, "normal": 24, "low": 48}
SLA_TEXT = {"urgent": "within 1 hour", "high": "within 4 business hours", "normal": "within 1 business day", "low": "within 2 business days"}

REASONS: dict[str, dict[str, str]] = {
    "human_request": {"label": "Customer asked for a human", "priority": "normal", "team": "General Support"},
    "fraud_security": {"label": "Possible fraud or account compromise", "priority": "urgent", "team": "Trust & Safety"},
    "legal_chargeback": {"label": "Chargeback, dispute or legal threat", "priority": "high", "team": "Billing"},
    "safety": {"label": "Product safety or injury report", "priority": "urgent", "team": "Product Safety"},
    "low_confidence": {"label": "AI confidence below threshold", "priority": "normal", "team": "General Support"},
    "repeated_friction": {"label": "Repeated low-confidence or frustrated turns", "priority": "high", "team": "General Support"},
    "carrier_trace": {"label": "Delayed shipment needs a carrier trace", "priority": "high", "team": "Orders & Shipping"},
    "missing_package": {"label": "Package marked delivered but not received", "priority": "high", "team": "Orders & Shipping"},
    "damaged_item_claim": {"label": "Damaged, defective or wrong item", "priority": "high", "team": "Returns"},
    "refund_approval": {"label": "Refund requires specialist approval", "priority": "normal", "team": "Returns"},
    "return_exception": {"label": "Return outside the policy window", "priority": "normal", "team": "Returns"},
    "complaint": {"label": "Customer complaint", "priority": "normal", "team": "Customer Experience"},
}
INTENT_TEAM = {
    "billing_payment": "Billing", "account_help": "Trust & Safety", "membership_rewards": "Billing",
    "order_status": "Orders & Shipping", "shipping_info": "Orders & Shipping", "cancel_modify_order": "Orders & Shipping",
    "returns_refunds": "Returns", "damaged_or_wrong_item": "Returns", "product_question": "Product Specialists",
}


class EscalationBrief(BaseModel):
    summary: str = Field(description="2-3 sentence briefing for the specialist: who, what they need, what the AI already did.")
    key_facts: list[str] = Field(description="Bullet facts: order ids, statuses, amounts, dates, verification state.")
    suggested_reply: str = Field(description="A ready-to-send first reply the specialist can edit. Do not promise outcomes that need approval.")


def _bump(priority: str) -> str:
    return PRIORITIES[min(PRIORITIES.index(priority) + 1, len(PRIORITIES) - 1)]


def compute_priority(reason: str, sentiment: str, urgency: str, customer: dict | None) -> tuple[str, list[str]]:
    base = REASONS.get(reason, {}).get("priority", "normal")
    priority, why = base, [f"base priority for '{reason}' is {base}"]
    vip = bool(customer and (customer.get("tier") == "Aurora+" or customer.get("lifetime_value", 0) >= 2000))
    if priority in ("low", "normal") and (sentiment == "angry" or vip or urgency in ("high", "urgent")):
        priority = _bump(priority)
        why.append("raised one level: " + ", ".join(
            x for x, on in (("angry customer", sentiment == "angry"), ("VIP customer", vip), ("urgent request", urgency in ("high", "urgent"))) if on
        ))
    return priority, why


def _offline_brief(state: SupportState, reason_label: str, ctx: dict) -> EscalationBrief:
    intent = state.get("intent", "general_inquiry")
    customer = ctx.get("customer") or ctx.get("verified_customer")
    who = f"{customer.get('name') or customer.get('first_name')} ({customer.get('tier')})" if customer else "Guest (not signed in)"
    asks = [str(m.content) for m in state.get("messages", []) if isinstance(m, HumanMessage)]
    facts = [f"Customer: {who}", f"Intent: {INTENTS.get(intent, {}).get('label', intent)}", f"Sentiment: {state.get('sentiment', 'neutral')}"]
    order = ctx.get("order")
    if order:
        facts.append(f"Order {order['order_id']}: {order['status']}, total ${order['total']:.2f}, {', '.join(order['items'])}")
        if order.get("tracking_number"):
            facts.append(f"Tracking: {order['carrier']} {order['tracking_number']} (ETA {order.get('estimated_delivery')})")
        elig = order["return_eligibility"]
        facts.append(f"Return eligibility: {'eligible' if elig.get('eligible') else 'not eligible'} — {elig.get('reason')}")
    elif (ctx.get("order_lookup") or {}).get("order_id"):
        lk = ctx["order_lookup"]
        facts.append(f"Order {lk['order_id']}: lookup result '{lk['result']}'")
    if state.get("confidence"):
        facts.append(f"AI confidence on last turn: {state['confidence']:.0%}")
    if state.get("escalation_detail"):
        facts.append(f"Trigger: {state['escalation_detail']}")

    summary = (
        f"{who} contacted support about {INTENTS.get(intent, {}).get('label', intent).lower()}. "
        f"Latest message: “{asks[-1][:220] if asks else ''}”. "
        f"Escalated because: {reason_label.lower()}."
        + (f" Earlier in the conversation they said: “{asks[-2][:140]}”." if len(asks) > 1 else "")
    )
    name = first_name(state)
    draft = (state.get("draft_response") or "") if state.get("draft_shareable") else ""
    suggested = (
        f"Hi {name or 'there'}, this is a specialist from the {get_settings().company_name} support team — I've read through your conversation"
        + (f" about {order['order_id']}" if order else "")
        + ". "
        + ("I'm looking into this now and will update you shortly." if not draft else "Here's where things stand:\n\n" + draft)
    )
    return EscalationBrief(summary=summary, key_facts=facts, suggested_reply=suggested)


def _customer_message(reason: str, priority: str, ticket_id: str, team: str, draft: str, keep_draft: bool, name: str | None) -> str:
    opener = {
        "human_request": f"Of course{', ' + name if name else ''} — I'm connecting you with a member of our team now.",
        "fraud_security": "Thank you for flagging this — I'm treating it as urgent and connecting you with our Trust & Safety team right away.",
        "safety": "Thank you for telling us — your safety comes first. If anyone is hurt, please seek medical help right away.",
        "legal_chargeback": "I understand, and I want to get this resolved for you properly. I'm bringing in a billing specialist.",
        "low_confidence": "I want to make sure you get an accurate answer rather than a guess, so I'm bringing in a specialist.",
        "repeated_friction": "I'm sorry I haven't been able to sort this out for you — let me get a specialist involved.",
    }.get(reason, "I've passed this to a specialist who can take care of it.")

    body = f"{draft.strip()}\n\n{opener}" if keep_draft and draft.strip() else opener
    extra = ""
    if reason == "fraud_security":
        extra = "\n\nIn the meantime, please **reset your password** and enable **two-factor authentication**. We'll never ask for your password or 2FA codes."
    return (
        f"{body}\n\n"
        f"- Ticket: **{ticket_id}** · {team}\n"
        f"- Priority: **{priority.capitalize()}** — expected reply {SLA_TEXT[priority]}\n"
        f"- They'll see our whole conversation, so you won't need to repeat anything. Their reply will appear right here."
        f"{extra}"
    )


def escalation_agent(state: SupportState) -> dict:
    reason = state.get("escalation_reason") or "low_confidence"
    meta = REASONS.get(reason, {"label": reason.replace("_", " ").capitalize(), "priority": "normal", "team": "General Support"})
    team = meta["team"] if meta["team"] != "General Support" else INTENT_TEAM.get(state.get("intent", ""), meta["team"])

    ctx = state.get("account_context") or {}
    entity_updates: dict = {}
    if not ctx:
        ctx, entity_updates = gather_account_context(dict(state))
    customer = commerce.get_customer(state.get("customer_id")) or ctx.get("verified_customer")
    priority, priority_why = compute_priority(reason, state.get("sentiment", "neutral"), state.get("urgency", "normal"), customer)

    brief = structured_call(
        EscalationBrief,
        [
            SystemMessage("You write handoff briefings for human customer-support specialists. Be factual and specific; use only provided information."),
            HumanMessage(
                f"Escalation reason: {meta['label']} ({state.get('escalation_detail') or 'n/a'})\n"
                f"Intent: {state.get('intent')} · sentiment: {state.get('sentiment')} · AI confidence: {state.get('confidence')}\n"
                f"Account data: {ctx}\nMemory summary: {state.get('memory_summary') or '(none)'}\n"
                f"Conversation:\n{transcript(state.get('messages', []), 16)}\n\n"
                + (
                    f"AI draft reply (not sent as final answer): {state.get('draft_response') or '(none)'}"
                    if state.get("draft_shareable")
                    else f"AI draft reply (BLOCKED by a guardrail — do not reuse its claims or promises): {state.get('draft_response') or '(none)'}"
                )
            ),
        ],
    ) or _offline_brief(state, meta["label"], ctx)

    summary = brief.summary + "\n\n" + "\n".join(f"- {f}" for f in brief.key_facts)
    conversation_id = state["conversation_id"]
    existing = db.open_ticket_for_conversation(conversation_id)
    sla_due = (datetime.now(timezone.utc) + timedelta(hours=SLA_HOURS[priority])).isoformat(timespec="seconds")
    if existing:
        new_priority = max(existing["priority"], priority, key=PRIORITIES.index)
        db.update_ticket(existing["id"], priority=new_priority, summary=summary, suggested_reply=brief.suggested_reply,
                         reason=f"{existing['reason']}; {meta['label']}" if meta["label"] not in (existing["reason"] or "") else existing["reason"])
        ticket = db.get_ticket(existing["id"])
    else:
        ticket = db.create_ticket(
            conversation_id=conversation_id,
            customer_id=state.get("customer_id") or (ctx.get("verified_customer") or {}).get("customer_id"),
            priority=priority,
            category=team,
            reason=meta["label"] + (f" — {state['escalation_detail']}" if state.get("escalation_detail") else ""),
            summary=summary,
            suggested_reply=brief.suggested_reply,
            confidence=state.get("confidence") or None,
            sla_due_at=sla_due,
        )
        webhooks.emit("ticket.created", {"ticket": ticket, "customer_id": ticket.get("customer_id")})
    db.update_conversation(conversation_id, status="escalated")
    approval = _queue_approval(state, reason, ctx, ticket["id"])

    keep_draft = (
        bool(state.get("draft_shareable") and state.get("draft_response"))
        and (state.get("generation_confidence") or 0) >= 0.6
        and reason not in ("low_confidence",)
    )
    message = _customer_message(reason, ticket["priority"], ticket["id"], team, state.get("draft_response", ""), keep_draft, first_name(state))
    message = localize(message, state.get("language"))

    updates: dict = {
        "ticket": {**ticket, "priority_rationale": priority_why},
        "final_response": message,
        "messages": [AIMessage(content=message, name="escalation_agent")],
        "escalate": True,
        "action": "escalate",
        "escalation_reason": reason,
        "low_confidence_streak": 0,
    }
    if approval:
        updates["action_result"] = {k: approval[k] for k in ("id", "type", "label", "status", "order_id", "amount")}
    if entity_updates:
        updates["entities"] = entity_updates
    if not state.get("account_context"):
        updates["account_context"] = ctx
    return updates


def _queue_approval(state: SupportState, reason: str, ctx: dict, ticket_id: str) -> dict | None:
    """Refund decisions become one-click Approve / Deny actions on the ticket."""
    queued = state.get("action_result") or {}
    if queued.get("status") == "pending_approval":
        db.update_row("actions", queued["id"], ticket_id=ticket_id)
        return actions.get(queued["id"])
    order = ctx.get("order")
    if reason not in ("refund_approval", "return_exception") or not order:
        return None
    existing = actions.pending_for_order(order["order_id"])
    if existing:
        return existing
    action = actions.request("refund", order["order_id"], requested_by="ai", conversation_id=state.get("conversation_id"),
                             ticket_id=ticket_id, force_approval=True)
    return action if action["status"] == "pending_approval" else None

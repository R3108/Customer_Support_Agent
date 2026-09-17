"""Deterministic response engine used when no LLM is configured (or a provider fails).

It composes answers from verified account data and extractive knowledge-base passages,
and reports a rule-based certainty that feeds the confidence scorer.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import date
from typing import Any

from ..config import get_settings
from ..rag.retriever import tokenize
from .context import first_name
from .memory import last_customer_message


@dataclass
class Draft:
    text: str
    action: str = "answer"  # answer | clarify | escalate
    confidence: float = 0.8
    sources: list[str] = field(default_factory=list)
    escalation_reason: str = ""
    escalation_detail: str = ""


STATUS_LABEL = {
    "processing": "Processing",
    "shipped": "Shipped",
    "delayed": "Delayed",
    "out_for_delivery": "Out for delivery",
    "delivered": "Delivered",
    "canceled": "Canceled",
    "return_in_progress": "Return in progress",
    "refunded": "Refunded",
}

# General inquiries whose best knowledge-base match is weaker than this are outside what we can answer.
MIN_KB_SCORE = 0.45


def scope_reply() -> Draft:
    settings = get_settings()
    return Draft(
        f"I'm {settings.assistant_name}, {settings.company_name}'s support assistant, so I can help with orders, shipping, returns, "
        "billing, your account and our gear — but that question is outside what I can answer. "
        "Could you tell me a bit more about what you need? You can also ask to talk to a person at any time.",
        action="clarify", confidence=0.6,
    )


def fmt_date(iso: str | None) -> str:
    if not iso:
        return "—"
    d = date.fromisoformat(iso[:10])
    return f"{d:%b} {d.day}, {d.year}"


def money(value: float) -> str:
    return f"${value:,.2f}"


# ------------------------------------------------------------------ knowledge base
def _sentences(text: str) -> list[str]:
    units: list[str] = []
    for line in text.splitlines():
        line = line.strip()
        if not line:
            continue
        if re.match(r"^(-|\d+\.)\s", line):
            units.append(line)
        else:
            units.extend(s.strip() for s in re.split(r"(?<=[.!?])\s+(?=[A-Z*])", line) if s.strip())
    return units


def kb_answer(query: str, docs: list[dict[str, Any]], max_units: int = 4) -> tuple[str, list[str], float]:
    """Extractive answer: best-matching sentences/bullets from the top passages."""
    if not docs:
        return "", [], 0.0
    q_terms = set(tokenize(query, expand=True))
    top = docs[0]
    selected: list[tuple[float, int, str]] = []
    pool = [(0, top)] + [(1, d) for d in docs[1:2] if d["score"] >= max(0.6, top["score"] - 0.1)]
    for doc_rank, doc in pool:
        units = _sentences(doc["text"])
        for pos, unit in enumerate(units):
            overlap = len(q_terms & set(tokenize(unit)))
            bonus = 0.6 if pos == 0 and doc_rank == 0 else 0.0  # lead sentence usually states the rule
            is_bullet = unit.startswith(("-", "1.", "2.", "3.", "4."))
            score = overlap + bonus + (0.3 if is_bullet and overlap else 0) - doc_rank * 0.5
            selected.append((score, doc_rank * 100 + pos, unit))

    top_units = [t for t in selected if t[1] < 100]
    if len(top_units) <= 5 and top["score"] >= 0.75:
        # Short, highly relevant passage: keep it whole so no step or caveat is lost.
        best = top_units
    else:
        best = sorted(selected, key=lambda t: -t[0])[:max_units]
        best = [b for b in best if b[0] > 0] or best[:2]
    ordered = [u for _, _, u in sorted(best, key=lambda t: t[1])]
    # Keep bullet lists readable: blank line before a list that follows prose.
    lines: list[str] = []
    for unit in ordered:
        if unit.startswith("-") or re.match(r"^\d+\.", unit):
            if lines and not (lines[-1].startswith("-") or re.match(r"^\d+\.", lines[-1])):
                lines.append("")
            lines.append(unit)
        else:
            if lines and (lines[-1].startswith("-") or re.match(r"^\d+\.", lines[-1])):
                lines.append("")
            lines.append(unit)
    text = "\n".join(lines)
    text = re.sub(r"(?<!\n)\n(?![-\d\n])", " ", text)
    sources = [doc["id"] for _, doc in pool]
    return text.strip(), sources, float(top["score"])


# ------------------------------------------------------------------ orders
def order_list_text(orders: list[dict[str, Any]]) -> str:
    return "\n".join(
        f"- **{o['order_id']}** · {STATUS_LABEL.get(o['status'], o['status'])} · {o['items']} ({money(o['total'])})"
        for o in orders
    )


def describe_order_status(order: dict[str, Any], signals: dict[str, Any]) -> Draft:
    oid, status = order["order_id"], order["status"]
    items = ", ".join(i.split(" (")[0] for i in order["items"])
    health = order["shipment_health"]
    tracking = f"{order['carrier']} tracking **{order['tracking_number']}**" if order.get("tracking_number") else None
    last_event = order["tracking_events"][-1] if order.get("tracking_events") else None

    if status == "processing":
        return Draft(
            f"Your order **{oid}** ({items}) is **processing** — it's being prepared at our warehouse and hasn't shipped yet. "
            "Orders placed before 2:00 PM ET on a business day ship the same day, and you'll get a tracking email as soon as it leaves.\n\n"
            "Since it hasn't shipped, you can still change or cancel it from the **Orders** page.",
            confidence=0.93,
        )
    if status == "shipped":
        text = (
            f"Good news — **{oid}** ({items}) shipped on {fmt_date(order['shipped_at'])} via {order['shipping_method']} Shipping.\n\n"
            f"- Tracking: {tracking}\n- Estimated delivery: **{fmt_date(order['estimated_delivery'])}**"
        )
        if last_event:
            text += f"\n- Latest update ({fmt_date(last_event['date'])}): {last_event['description']}"
        if health["is_delayed"]:
            text += f"\n\nIt's now {health['days_past_eta']} days past the estimated date, which counts as delayed under our policy."
            return Draft(text, action="escalate", confidence=0.85, escalation_reason="carrier_trace",
                         escalation_detail=f"{oid} is {health['days_past_eta']} days past ETA")
        return Draft(text, confidence=0.94)
    if status == "out_for_delivery":
        return Draft(
            f"**{oid}** ({items}) is **out for delivery today** with {order['carrier']}! 🎉\n\n- Tracking: {tracking}"
            + (f"\n- Latest update: {last_event['description']}" if last_event else ""),
            confidence=0.95,
        )
    if status == "delayed":
        text = (
            f"I'm sorry — **{oid}** ({items}) is **delayed**. It shipped on {fmt_date(order['shipped_at'])} with an estimated delivery of "
            f"{fmt_date(order['estimated_delivery'])}"
        )
        if last_event:
            text += f", and the last carrier update was {health['days_since_last_update']} days ago: _{last_event['description']}_."
        else:
            text += "."
        if health["needs_carrier_trace"]:
            text += (
                "\n\nBecause there's been no movement for more than 5 business days, a specialist needs to open a trace with the carrier. "
                "If the carrier confirms it's lost, we'll send a free replacement with Expedited Shipping or a full refund — your choice."
            )
            return Draft(text, action="escalate", confidence=0.88, escalation_reason="carrier_trace",
                         escalation_detail=f"{oid}: no carrier scan for {health['days_since_last_update']} days")
        return Draft(text + "\n\nWe're monitoring it closely; carriers usually resume scanning within a few days.", confidence=0.85)
    if status == "delivered":
        text = f"**{oid}** ({items}) was marked **delivered** on {fmt_date(order['delivered_at'])}."
        if signals.get("delivered_not_received"):
            text += (
                "\n\nI'm sorry it hasn't turned up. Carriers sometimes mark packages delivered early, so please check around your property, "
                "with neighbors, and any mailroom. Missing-package claims are handled by our specialists, so I'm connecting you with one now."
            )
            return Draft(text, action="escalate", confidence=0.86, escalation_reason="missing_package",
                         escalation_detail=f"{oid} marked delivered {fmt_date(order['delivered_at'])} but not received")
        return Draft(text + " If anything's wrong with it, I can help with a return or exchange.", confidence=0.92)
    if status == "canceled":
        return Draft(
            f"**{oid}** was **canceled**, so nothing will ship. If you saw a pending authorization, it drops off within 3–7 business days depending on your bank.",
            confidence=0.92,
        )
    if status == "refunded":
        refund = order.get("refund") or {}
        return Draft(
            f"**{oid}** has been **refunded** — {money(refund.get('amount', order['total']))} was issued on {fmt_date(refund.get('issued_at'))} "
            "to your original payment method. Banks usually take 5–10 business days to post the credit.",
            confidence=0.93,
        )
    if status == "return_in_progress":
        ret = order.get("return") or {}
        return Draft(
            f"There's a return in progress for **{oid}** ({items}).\n\n- RMA: **{ret.get('rma', '—')}**\n- Reason: {ret.get('reason', '—')}\n"
            f"- Status: {ret.get('status', '—')}\n\nFor exchanges we ship the replacement as soon as the carrier scans your return.",
            confidence=0.92,
        )
    return Draft(f"**{oid}** is currently **{status}**.", confidence=0.7)


def describe_return(order: dict[str, Any], signals: dict[str, Any], tier: str | None) -> Draft:
    oid = order["order_id"]
    items = ", ".join(i.split(" (")[0] for i in order["items"])
    elig = order["return_eligibility"]
    limit = get_settings().refund_approval_limit
    wants_refund = bool(signals.get("refund_request"))

    if order["status"] == "return_in_progress":
        return describe_order_status(order, signals)
    if order["status"] == "processing":
        return Draft(
            f"**{oid}** hasn't shipped yet, so there's no need to return it — you can cancel it or remove items from the **Orders** page while it's processing.",
            confidence=0.9,
        )
    if not elig.get("eligible"):
        text = f"I checked **{oid}** ({items}): it isn't eligible for a standard return. {elig['reason']}"
        if elig.get("days_since_delivery") and elig["days_since_delivery"] > elig["window_days"] and wants_refund:
            text += "\n\nExceptions outside the return window need a specialist's approval, so I'm passing this along for review."
            return Draft(text, action="escalate", confidence=0.84, escalation_reason="return_exception",
                         escalation_detail=f"{oid}: {elig['reason']}")
        if order["status"] in ("shipped", "delayed", "out_for_delivery"):
            text += " Once it arrives you'll have the full return window, or you can refuse the delivery for a free return."
        return Draft(text, confidence=0.86)

    if elig.get("requires_human_approval") and wants_refund:
        return Draft(
            f"I checked **{oid}** ({items}) — it's within the return window. {elig['reason']}\n\n"
            f"Because the refund total (**{money(elig['refund_amount'])}**) is over our {money(limit)} self-service limit, "
            "a specialist needs to approve it. They'll confirm the refund and send you a prepaid return label.",
            action="escalate", confidence=0.87, escalation_reason="refund_approval",
            escalation_detail=f"{oid}: refund of {money(elig['refund_amount'])} exceeds {money(limit)} limit",
        )

    fee = "free" if elig["return_fee"] == 0 else f"a {money(elig['return_fee'])} return-shipping fee is deducted (exchanges are always free)"
    text = (
        f"Good news — **{oid}** ({items}) is eligible for a return. {elig['reason']}\n\n"
        "**How to start it:**\n"
        "1. Go to **Orders** and select **Start a return** next to the item.\n"
        "2. Choose refund or exchange and a reason.\n"
        "3. Print the prepaid label, or use the QR code at any UPS Store.\n\n"
        f"Return shipping is {fee}"
        + (" as an Aurora+ member." if tier == "Aurora+" and elig["return_fee"] == 0 else ".")
        + " Refunds are processed within 3 business days of the warehouse receiving it."
    )
    if elig.get("requires_human_approval"):
        text += f"\n\nNote: refunds over {money(limit)} are approved by a specialist once your return is started."
    return Draft(text, confidence=0.91)


def describe_cancel(order: dict[str, Any], text_in: str) -> Draft:
    oid = order["order_id"]
    wants_address = bool(re.search(r"address", text_in, re.I))
    if order["can_cancel"]:
        if wants_address:
            return Draft(
                f"**{oid}** is still **processing**, so you can update the shipping address yourself: open **Orders → {oid} → Change address**. "
                "Once it ships, address changes have to be requested directly with the carrier.",
                confidence=0.92,
            )
        return Draft(
            f"**{oid}** is still **processing**, so it can be changed or canceled.\n\n"
            f"- **Cancel:** Orders → {oid} → **Cancel order**. Any authorization is released within 3–7 business days.\n"
            "- **Change:** you can swap size/color or remove items. New items can't be added — place a new order for those.",
            confidence=0.92,
        )
    status = STATUS_LABEL.get(order["status"], order["status"]).lower()
    if wants_address and order["status"] in ("shipped", "delayed", "out_for_delivery"):
        return Draft(
            f"**{oid}** has already shipped, so we can't change the address on our side — but you can request a delivery change directly with "
            f"{order.get('carrier') or 'the carrier'} using tracking number **{order.get('tracking_number')}**.",
            confidence=0.88,
        )
    return Draft(
        f"**{oid}** is already **{status}**, so it can't be canceled anymore. "
        "You can refuse the delivery or start a free return once it arrives, and you'll be refunded when it's back with us.",
        confidence=0.88,
    )


# ------------------------------------------------------------------ main entry
def compose(state: dict[str, Any]) -> Draft:
    intent = state.get("intent", "general_inquiry")
    ctx = state.get("account_context") or {}
    docs = state.get("retrieved_docs") or []
    signals = state.get("signals") or {}
    text_in = last_customer_message(state.get("messages", []))
    query = state.get("standalone_query") or text_in
    name = first_name(state)
    settings = get_settings()
    order = ctx.get("order")
    lookup = ctx.get("order_lookup") or {}
    tier = (ctx.get("customer") or ctx.get("verified_customer") or {}).get("tier")

    if intent == "greeting":
        if re.search(r"\bthank", text_in, re.I):
            return Draft(f"You're very welcome{', ' + name if name else ''}! Is there anything else I can help you with?", confidence=0.95)
        return Draft(
            f"Hi{' ' + name if name else ''}! 👋 I'm {settings.assistant_name}, {settings.company_name}'s support assistant. "
            "I can track orders, handle returns and refunds, and answer billing, account and product questions. What can I help with today?",
            confidence=0.95,
        )

    order_intents = {"order_status", "returns_refunds", "cancel_modify_order", "damaged_or_wrong_item"}

    # ---- verification / lookup problems come first
    if intent in order_intents or (lookup and intent == "billing_payment"):
        result = lookup.get("result")
        oid = lookup.get("order_id")
        if result == "verification_required":
            return Draft(
                f"I can look up **{oid}** for you. To protect your privacy, please confirm the **email address** used to place the order.",
                action="clarify", confidence=0.85,
            )
        if result == "verification_failed":
            return Draft(
                f"That email doesn't match our records for **{oid}**. Could you double-check the email address you used at checkout? "
                "If you signed in with a different account, try that email.",
                action="clarify", confidence=0.8,
            )
        if result == "not_found":
            return Draft(
                f"I couldn't find an order **{oid}** {'on your account' if ctx.get('authenticated') else 'in our system'}. "
                "Order numbers start with **ORD-** followed by five digits (e.g. ORD-10421) and appear in your confirmation email. Could you double-check it?",
                action="clarify", confidence=0.78,
            )
        if not order and intent in order_intents:
            if ctx.get("candidate_orders"):
                verb = {"order_status": "check on", "returns_refunds": "return", "cancel_modify_order": "change",
                        "damaged_or_wrong_item": "report an issue with"}[intent]
                return Draft(
                    f"Which order would you like to {verb}{', ' + name if name else ''}? Here are the ones that match:\n\n"
                    f"{order_list_text(ctx['candidate_orders'])}",
                    action="clarify", confidence=0.85,
                )
            if ctx.get("authenticated") and intent != "damaged_or_wrong_item":
                recent = (ctx.get("customer") or {}).get("recent_orders", [])
                if recent:
                    kb_text, sources, _ = kb_answer(query, docs, 3)
                    return Draft(
                        f"I don't see a matching open order on your account. Your recent orders:\n\n{order_list_text(recent[:3])}\n\n"
                        "Which one do you mean?" + (f"\n\n{kb_text}" if intent == "returns_refunds" and kb_text else ""),
                        action="clarify", confidence=0.78, sources=sources if intent == "returns_refunds" else [],
                    )
            if intent == "damaged_or_wrong_item":
                return Draft(
                    "I'm really sorry about that. Could you share your **order number** (it starts with ORD-) and, if you can, a photo of the issue? "
                    "Then I'll get a replacement or refund moving right away.",
                    action="clarify", confidence=0.82,
                )
            kb_text, sources, score = kb_answer(query, docs, 3)
            ask = "Could you share your **order number** (e.g. ORD-10421) and the **email** used at checkout? Then I can pull up the details."
            if intent in ("returns_refunds", "cancel_modify_order") and kb_text and score >= 0.5:
                return Draft(f"{kb_text}\n\nIf you'd like me to check a specific order, {ask[0].lower()}{ask[1:]}",
                             confidence=min(0.9, 0.45 + score * 0.5), sources=sources)
            return Draft(ask, action="clarify", confidence=0.82)

    # ---- data-grounded answers
    if order and intent == "order_status":
        return describe_order_status(order, signals)
    if order and intent == "returns_refunds":
        return describe_return(order, signals, tier)
    if order and intent == "cancel_modify_order":
        return describe_cancel(order, text_in)
    if order and intent == "damaged_or_wrong_item":
        return Draft(
            f"I'm so sorry your order **{order['order_id']}** didn't arrive in good shape. Damaged, defective and wrong-item claims are covered "
            "in full — we pay return shipping and send a replacement or a full refund, whichever you prefer.\n\n"
            "If you have a photo of the problem, please reply with it; it speeds up the review.",
            action="escalate", confidence=0.88, escalation_reason="damaged_item_claim",
            escalation_detail=f"{order['order_id']}: {signals.get('damaged_or_wrong') or 'reported issue'}",
        )

    if intent == "complaint":
        kb_text, sources, _ = kb_answer(query, docs, 2)
        return Draft(
            f"I'm genuinely sorry about your experience{', ' + name if name else ''} — that's not the standard we hold ourselves to. "
            "I want to make sure this gets proper attention from our team.",
            action="escalate", confidence=0.8, escalation_reason="complaint", sources=[],
        )

    kb_text, sources, score = kb_answer(query, docs)
    prefix = ""
    if intent == "membership_rewards" and ctx.get("customer"):
        c = ctx["customer"]
        prefix = (
            f"You're on the **{c['tier']}** plan"
            + (f" (renews {fmt_date(c['membership_renews'])})" if c.get("membership_renews") else "")
            + f" with **{c['rewards_points']:,} rewards points** — that's {c['rewards_points'] // 500} × $10 rewards available.\n\n"
        )
    elif intent == "billing_payment" and order:
        prefix = f"For **{order['order_id']}**, the total was **{money(order['total'])}** charged to {order['payment_method']}.\n\n"

    if not kb_text or score < MIN_KB_SCORE:
        if prefix:
            return Draft(prefix.strip(), confidence=0.8)
        if intent == "general_inquiry":
            return scope_reply()
        return Draft(
            "I'm not confident I have the right answer to that, and I'd rather not guess.",
            confidence=0.25, sources=[],
        )
    gen_conf = min(0.92, 0.35 + score * 0.6)
    if prefix:
        gen_conf = max(gen_conf, 0.85)
    return Draft(prefix + kb_text, confidence=round(gen_conf, 3), sources=sources)

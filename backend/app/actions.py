"""Order actions the assistant can perform, with policy checks and human approval.

Flow: the Support Agent *proposes* an in-policy action and asks the customer to confirm;
the Action Agent executes it on "yes". Anything above policy limits (e.g. refunds over
the approval limit or outside the return window) becomes a `pending_approval` action
that a specialist approves or denies from the console.
"""

from __future__ import annotations

import re
import uuid
from typing import Any

from . import commerce, db, webhooks
from .config import get_settings

ACTION_TYPES: dict[str, dict[str, str]] = {
    "cancel_order": {"label": "Cancel order", "intent": "cancel_modify_order"},
    "start_return": {"label": "Start return", "intent": "returns_refunds"},
    "refund": {"label": "Issue refund", "intent": "returns_refunds"},
}

CANCEL_REQUEST = re.compile(r"\b(cancel|cancelar|annuler|stornier)", re.I)
ADDRESS_REQUEST = re.compile(r"\b(address|dirección|adresse)\b", re.I)
RETURN_REQUEST = re.compile(
    r"\b(return|refund|send (it )?back|money back|exchange|devolver|devoluci[oó]n|reembolso|retourner|remboursement|"
    r"r[uü]cksendung|r[uü]ckerstattung|zur[uü]ckgeben|devolu[cç][aã]o)\b", re.I,
)
AFFIRMATIVE = re.compile(r"^\s*(yes|yeah|yep|yup|sure|ok(ay)?|please( do)?|do it|go ahead|confirm(ed)?|sounds good|sí|si|oui|ja|sim)\b", re.I)
NEGATIVE = re.compile(r"^\s*(no|nope|nah|don'?t|do not|not now|never ?mind|keep it|stop|non|nein|não)\b", re.I)


def money(value: float | None) -> str:
    return f"${(value or 0):,.2f}"


# ---------------------------------------------------------------- policy
def check(action_type: str, order: dict[str, Any], customer: dict[str, Any] | None) -> tuple[bool, str]:
    """Can this action be performed on the order at all?"""
    summary = commerce.order_summary(order, customer)
    if action_type == "cancel_order":
        return (True, "") if summary["can_cancel"] else (False, f"{order['id']} is already {order['status'].replace('_', ' ')} and can't be canceled.")
    if action_type == "start_return":
        if order["status"] != "delivered":
            return False, f"{order['id']} is {order['status'].replace('_', ' ')}, so a return can't be started."
        elig = summary["return_eligibility"]
        return (True, "") if elig["eligible"] else (False, elig["reason"])
    if action_type == "refund":
        if order["status"] in ("refunded", "canceled"):
            return False, f"{order['id']} is already {order['status']}."
        if order["status"] not in ("delivered", "return_in_progress"):
            return False, f"{order['id']} hasn't been delivered yet."
        return True, ""
    return False, f"Unknown action {action_type}."


def needs_approval(action_type: str, order: dict[str, Any], customer: dict[str, Any] | None) -> bool:
    if action_type != "refund":
        return False
    elig = commerce.order_summary(order, customer)["return_eligibility"]
    return order["total"] > get_settings().refund_approval_limit or (elig.get("days_since_delivery") or 0) > elig["window_days"]


def propose(intent: str, order: dict[str, Any] | None, text: str) -> dict[str, Any] | None:
    """Offer an in-policy action the AI can take right now (the customer confirms first)."""
    if not order or not get_settings().auto_actions_enabled:
        return None
    oid = order["order_id"]
    if intent == "cancel_modify_order" and order["can_cancel"] and CANCEL_REQUEST.search(text) and not ADDRESS_REQUEST.search(text):
        return {"type": "cancel_order", "order_id": oid, "label": ACTION_TYPES["cancel_order"]["label"],
                "prompt": f"I can cancel **{oid}** for you right now. Reply **yes** to confirm, or **no** to keep the order."}
    elig = order["return_eligibility"]
    if intent == "returns_refunds" and order["status"] == "delivered" and elig.get("eligible") and RETURN_REQUEST.search(text):
        fee = "free" if not elig.get("return_fee") else f"{money(elig['return_fee'])} return shipping is deducted from the refund"
        return {"type": "start_return", "order_id": oid, "label": ACTION_TYPES["start_return"]["label"],
                "prompt": f"I can start the return for **{oid}** now and send you a prepaid label ({fee}). Reply **yes** to confirm, or **no** if you'd rather wait."}
    return None


# ---------------------------------------------------------------- lifecycle
def request(
    action_type: str,
    order_id: str,
    *,
    requested_by: str,
    conversation_id: str | None = None,
    ticket_id: str | None = None,
    force_approval: bool = False,
) -> dict[str, Any]:
    """Create an action: executed immediately when in policy, otherwise queued for approval."""
    order = commerce.get_order(order_id)
    customer = commerce.get_customer(order["customer_id"]) if order else None
    action_id = f"act_{uuid.uuid4().hex[:10]}"
    ts = db.now_iso()
    record: dict[str, Any] = {
        "id": action_id, "type": action_type, "status": "pending_approval", "conversation_id": conversation_id,
        "ticket_id": ticket_id, "customer_id": order["customer_id"] if order else None, "order_id": order_id,
        "amount": order["total"] if order else None, "params": {}, "result": {}, "requested_by": requested_by,
        "created_at": ts, "updated_at": ts,
    }
    allowed, reason = check(action_type, order, customer) if order else (False, f"Order {order_id} not found.")
    if not allowed:
        record.update(status="failed", result={"error": reason})
        db.insert("actions", record)
        return get(action_id)  # type: ignore[return-value]

    db.insert("actions", record)
    if force_approval or needs_approval(action_type, order, customer):  # type: ignore[arg-type]
        action = get(action_id)
        webhooks.emit("action.approval_requested", {"action": action})
        return action  # type: ignore[return-value]
    return execute(action_id, decided_by=None)


def execute(action_id: str, decided_by: str | None) -> dict[str, Any]:
    action = get(action_id)
    if action is None:
        raise KeyError(action_id)
    order = commerce.get_order(action["order_id"])
    customer = commerce.get_customer(order["customer_id"]) if order else None
    allowed, reason = check(action["type"], order, customer) if order else (False, "Order not found.")
    ts = db.now_iso()
    if not allowed:
        db.update_row("actions", action_id, status="failed", result={"error": reason}, decided_by=decided_by, decided_at=ts, updated_at=ts)
        return get(action_id)  # type: ignore[return-value]

    result = _apply(action["type"], order, customer)  # type: ignore[arg-type]
    db.update_row("actions", action_id, status="executed", result=result, decided_by=decided_by, decided_at=ts, updated_at=ts)
    executed = get(action_id)
    webhooks.emit("action.completed", {"action": executed})
    return executed  # type: ignore[return-value]


def deny(action_id: str, decided_by: str, note: str | None) -> dict[str, Any]:
    ts = db.now_iso()
    db.update_row("actions", action_id, status="denied", decided_by=decided_by, decision_note=note, decided_at=ts, updated_at=ts)
    return get(action_id)  # type: ignore[return-value]


def _apply(action_type: str, order: dict[str, Any], customer: dict[str, Any] | None) -> dict[str, Any]:
    today = commerce.TODAY.isoformat()
    events = list(order.get("events") or [])
    oid, total, method = order["id"], order["total"], order["payment_method"]
    if action_type == "cancel_order":
        refund = {"amount": total, "issued_at": today, "method": method}
        events.append({"date": today, "status": "Canceled at customer request"})
        commerce.update_order(oid, status="canceled", refund=refund, events=events)
        return {"message": f"Done — **{oid}** is canceled. The {money(total)} authorization on your {method} will be released within 3–7 business days.",
                "refund": refund}
    if action_type == "start_return":
        fee = commerce.return_eligibility(order, customer)["return_fee"]
        rma = f"RMA-{uuid.uuid4().hex[:5].upper()}"
        ret = {"rma": rma, "reason": "Customer-initiated return", "label_created": today, "status": "Label emailed · awaiting drop-off"}
        events.append({"date": today, "status": f"Return {rma} started"})
        commerce.update_order(oid, status="return_in_progress", **{"return": ret}, events=events)
        email = (customer or {}).get("email", "")
        masked = re.sub(r"(^.).*(@.*$)", r"\1•••\2", email) if email else "your email"
        return {"message": f"Your return for **{oid}** is started — RMA **{rma}**. I've emailed a prepaid label to {masked}. "
                           f"Drop the package off within 14 days; your refund of **{money(total - fee)}** goes back to {method} once it's scanned "
                           "at our warehouse (usually 5–7 business days).",
                "rma": rma}
    if action_type == "refund":
        refund = {"amount": total, "issued_at": today, "method": method}
        events.append({"date": today, "status": "Refund issued"})
        commerce.update_order(oid, status="refunded", refund=refund, events=events)
        return {"message": f"Good news — your refund of **{money(total)}** for **{oid}** has been approved. It will appear on your {method} within 5–10 business days.",
                "refund": refund}
    raise ValueError(action_type)


# ---------------------------------------------------------------- queries
def get(action_id: str) -> dict[str, Any] | None:
    return _decorate(db.get_row("actions", action_id))


def list_actions(status: str | None = None, conversation_id: str | None = None) -> list[dict[str, Any]]:
    sql, params = "SELECT * FROM actions WHERE 1=1", []
    if status:
        sql += " AND status = ?"
        params.append(status)
    if conversation_id:
        sql += " AND conversation_id = ?"
        params.append(conversation_id)
    return [_decorate(a) for a in db.query(sql + " ORDER BY created_at DESC", tuple(params))]  # type: ignore[misc]


def pending_for_order(order_id: str) -> dict[str, Any] | None:
    rows = db.query("SELECT * FROM actions WHERE order_id = ? AND status = 'pending_approval' LIMIT 1", (order_id,))
    return _decorate(rows[0]) if rows else None


def _decorate(action: dict[str, Any] | None) -> dict[str, Any] | None:
    if action is None:
        return None
    return {**action, "label": ACTION_TYPES.get(action["type"], {}).get("label", action["type"])}

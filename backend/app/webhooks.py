"""Outbound webhooks and Slack alerts.

Generic webhooks receive a JSON envelope signed with HMAC-SHA256
(`X-Relay-Signature: sha256=<hex>` over `<timestamp>.<body>`). Slack webhooks receive a
formatted `text` message suitable for an incoming-webhook URL.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import logging
import secrets
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from typing import Any

import httpx

from . import db
from .config import get_settings

log = logging.getLogger("relay.webhooks")

EVENTS: dict[str, str] = {
    "ticket.created": "An escalation opened a new ticket",
    "ticket.resolved": "A specialist resolved a ticket",
    "action.approval_requested": "An action (e.g. a large refund) needs specialist approval",
    "action.completed": "An order action was executed by the AI or approved by a specialist",
    "sla.breached": "An open ticket passed its SLA due time",
    "feedback.negative": "A customer rated the conversation 1 or 2 stars",
}
_executor = ThreadPoolExecutor(max_workers=4, thread_name_prefix="relay-webhook")


# ---------------------------------------------------------------- management
def create(name: str, url: str, kind: str, events: list[str]) -> dict[str, Any]:
    hook_id = f"wh_{uuid.uuid4().hex[:10]}"
    db.insert("webhooks", {
        "id": hook_id, "name": name, "url": url, "kind": kind, "events": events,
        "secret": f"whsec_{secrets.token_hex(16)}" if kind == "generic" else None,
        "active": 1, "created_at": db.now_iso(),
    })
    return get(hook_id)  # type: ignore[return-value]


def get(hook_id: str) -> dict[str, Any] | None:
    return _public(db.get_row("webhooks", hook_id))


def list_all() -> list[dict[str, Any]]:
    return [_public(h) for h in db.query("SELECT * FROM webhooks ORDER BY created_at DESC")]  # type: ignore[misc]


def deliveries(limit: int = 50) -> list[dict[str, Any]]:
    return db.query(
        "SELECT d.*, w.name AS webhook_name FROM webhook_deliveries d LEFT JOIN webhooks w ON w.id = d.webhook_id "
        "ORDER BY d.id DESC LIMIT ?",
        (limit,),
    )


def _public(hook: dict[str, Any] | None) -> dict[str, Any] | None:
    if hook is None:
        return None
    return {**hook, "active": bool(hook["active"])}


# ---------------------------------------------------------------- delivery
def emit(event: str, data: dict[str, Any]) -> None:
    """Fan an event out to every active webhook subscribed to it. Never raises."""
    try:
        hooks = [h for h in db.query("SELECT * FROM webhooks WHERE active = 1") if event in (h["events"] or [])]
    except Exception:  # noqa: BLE001
        log.exception("Could not load webhooks for %s", event)
        return
    envelope = {"id": f"evt_{uuid.uuid4().hex[:12]}", "event": event, "created_at": db.now_iso(), "data": data}
    for hook in hooks:
        if get_settings().webhook_async:
            _executor.submit(deliver, hook, envelope)
        else:
            deliver(hook, envelope)


def deliver(hook: dict[str, Any], envelope: dict[str, Any]) -> dict[str, Any]:
    if hook["kind"] == "slack":
        body = json.dumps({"text": slack_text(envelope["event"], envelope["data"])})
        headers = {"Content-Type": "application/json"}
    else:
        body = json.dumps(envelope, default=str)
        timestamp = str(int(time.time()))
        signature = hmac.new((hook["secret"] or "").encode(), f"{timestamp}.{body}".encode(), hashlib.sha256).hexdigest()
        headers = {
            "Content-Type": "application/json",
            "User-Agent": "Relay-Webhooks/1.0",
            "X-Relay-Event": envelope["event"],
            "X-Relay-Timestamp": timestamp,
            "X-Relay-Signature": f"sha256={signature}",
        }
    started = time.perf_counter()
    status_code, error = None, None
    try:
        status_code = _send(hook["url"], body, headers)
        ok = 200 <= status_code < 300
        if not ok:
            error = f"HTTP {status_code}"
    except Exception as exc:  # noqa: BLE001
        ok, error = False, str(exc)[:300]
    record = {
        "webhook_id": hook["id"], "event": envelope["event"], "ok": int(ok), "status_code": status_code, "error": error,
        "duration_ms": round((time.perf_counter() - started) * 1000), "created_at": db.now_iso(),
    }
    db.insert("webhook_deliveries", record)
    return {**record, "ok": ok}


def _send(url: str, body: str, headers: dict[str, str]) -> int:
    return httpx.post(url, content=body, headers=headers, timeout=5.0).status_code


def verify_signature(secret: str, timestamp: str, body: str, signature: str) -> bool:
    """Reference implementation for receivers."""
    expected = hmac.new(secret.encode(), f"{timestamp}.{body}".encode(), hashlib.sha256).hexdigest()
    return hmac.compare_digest(f"sha256={expected}", signature)


def slack_text(event: str, data: dict[str, Any]) -> str:
    company = get_settings().company_name
    ticket = data.get("ticket") or {}
    action = data.get("action") or {}
    emoji = {"urgent": ":rotating_light:", "high": ":large_orange_circle:"}.get(ticket.get("priority", ""), ":speech_balloon:")
    if event == "ticket.created":
        return f"{emoji} *New {ticket.get('priority', '')} ticket {ticket.get('id')}* · {ticket.get('category')}\n>{ticket.get('reason')}"
    if event == "ticket.resolved":
        return f":white_check_mark: Ticket *{ticket.get('id')}* resolved by {data.get('agent_name') or 'a specialist'}"
    if event == "sla.breached":
        return f":alarm_clock: *SLA breached* on {ticket.get('priority')} ticket *{ticket.get('id')}* ({ticket.get('category')}) — {ticket.get('reason')}"
    if event == "action.approval_requested":
        return f":raised_hand: *Approval needed:* {action.get('label')} for {action.get('order_id')} (${action.get('amount') or 0:,.2f})"
    if event == "action.completed":
        return f":zap: {action.get('label')} completed for {action.get('order_id')} by {action.get('decided_by') or 'Relay AI'}"
    if event == "feedback.negative":
        return f":thumbsdown: {company} customer rated conversation {data.get('conversation_id')} {data.get('rating')}/5"
    return f"Relay event `{event}`"


# ---------------------------------------------------------------- SLA monitor
def check_sla_breaches(now: datetime | None = None) -> int:
    now = now or datetime.now(timezone.utc)
    breached = [
        t for t in db.query("SELECT * FROM tickets WHERE status != 'resolved' AND sla_due_at IS NOT NULL AND sla_breach_notified = 0")
        if datetime.fromisoformat(t["sla_due_at"]) < now
    ]
    for ticket in breached:
        db.update_ticket(ticket["id"], sla_breach_notified=1)
        emit("sla.breached", {"ticket": {k: ticket[k] for k in ("id", "priority", "category", "reason", "sla_due_at", "conversation_id")}})
    return len(breached)

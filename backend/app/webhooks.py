"""Outbound webhooks and Slack alerts, delivered through a durable outbox.

Generic webhooks receive a JSON envelope signed with HMAC-SHA256
(`X-Relay-Signature: sha256=<hex>` over `<timestamp>.<body>`). Slack webhooks receive a
formatted `text` message suitable for an incoming-webhook URL.

Every event is first written to `webhook_outbox`, then attempted. Failures are retried with exponential
backoff and jitter by a background worker (so a receiver's outage or a restart doesn't lose events); after
`RELAY_WEBHOOK_MAX_ATTEMPTS` the delivery is dead-lettered and can be replayed from the console. The envelope
`id` is identical on every attempt, so receivers can de-duplicate; `X-Relay-Attempt` says which try this is.

Delivery refuses URLs that resolve to private, loopback or link-local addresses (SSRF: e.g. the cloud metadata
endpoint), unless `RELAY_WEBHOOK_ALLOW_PRIVATE_NETWORKS` is on.
"""

from __future__ import annotations

import hashlib
import hmac
import ipaddress
import json
import logging
import random
import secrets
import socket
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from typing import Any
from urllib.parse import urlsplit

import httpx

from . import db
from .config import get_settings
from .observability import WEBHOOK_ATTEMPTS

log = logging.getLogger("relay.webhooks")

EVENTS: dict[str, str] = {
    "ticket.created": "An escalation opened a new ticket",
    "ticket.resolved": "A specialist resolved a ticket",
    "action.approval_requested": "An action (e.g. a large refund) needs specialist approval",
    "action.completed": "An order action was executed by the AI or approved by a specialist",
    "sla.breached": "An open ticket passed its SLA due time",
    "feedback.negative": "A customer rated the conversation 1 or 2 stars",
    "insight.spike": "Pulse detected an emerging issue (a topic or negative sentiment surging above its baseline)",
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
    """Queue an event for every active webhook subscribed to it, then try delivering right away. Never raises."""
    try:
        if _from_sandbox(data):
            return  # Test Lab runs must never page the team or reach integrations
        hooks = [h for h in db.query("SELECT * FROM webhooks WHERE active = 1") if event in (h["events"] or [])]
        envelope = json.loads(json.dumps(
            {"id": f"evt_{uuid.uuid4().hex[:12]}", "event": event, "created_at": db.now_iso(), "data": data}, default=str
        ))
        ts = db.now_iso()
        queued = []
        for hook in hooks:
            outbox_id = f"whd_{uuid.uuid4().hex[:12]}"
            db.insert("webhook_outbox", {
                "id": outbox_id, "webhook_id": hook["id"], "event": event, "envelope": envelope, "status": "pending",
                "attempts": 0, "next_attempt_at": ts, "created_at": ts, "updated_at": ts,
            })
            queued.append(outbox_id)
    except Exception:  # noqa: BLE001
        log.exception("Could not queue webhooks for %s", event)
        return
    for outbox_id in queued:
        if get_settings().webhook_async:
            _executor.submit(attempt, outbox_id)
        else:
            attempt(outbox_id)


# ---------------------------------------------------------------- outbox
BACKOFF_SECONDS = (30, 120, 600, 3600, 6 * 3600, 24 * 3600)


def _backoff(attempts: int) -> float:
    base = BACKOFF_SECONDS[min(attempts - 1, len(BACKOFF_SECONDS) - 1)]
    return base * random.uniform(0.8, 1.2)  # jitter: don't retry every failed delivery in lockstep


def attempt(outbox_id: str, force: bool = False) -> dict[str, Any] | None:
    """Try one outbox delivery. Claims the row first, so the worker and an inline attempt never double-send."""
    claim = "UPDATE webhook_outbox SET status = 'sending', updated_at = ? WHERE id = ? AND status = 'pending'"
    if force:
        claim = "UPDATE webhook_outbox SET status = 'sending', updated_at = ? WHERE id = ? AND status IN ('pending', 'dead')"
    if db.execute(claim, (db.now_iso(), outbox_id)).rowcount != 1:
        return None
    row = db.get_row("webhook_outbox", outbox_id)
    assert row is not None
    hook = db.get_row("webhooks", row["webhook_id"])
    attempts = row["attempts"] + 1
    now = datetime.now(timezone.utc)
    if not hook or not hook["active"]:
        fields: dict[str, Any] = {"status": "dead", "last_error": "Webhook was deleted or disabled", "attempts": row["attempts"]}
    else:
        result = deliver(hook, row["envelope"], attempt=attempts, delivery_id=outbox_id)
        fields = {"attempts": attempts, "last_status_code": result["status_code"], "last_error": result["error"]}
        if result["ok"]:
            fields.update(status="delivered", delivered_at=db.now_iso())
        elif attempts >= get_settings().webhook_max_attempts:
            fields["status"] = "dead"
            log.warning("Webhook delivery %s (%s → %s) dead-lettered after %d attempts: %s",
                        outbox_id, row["event"], hook["url"], attempts, result["error"])
        else:
            fields.update(status="pending", next_attempt_at=(now + timedelta(seconds=_backoff(attempts))).isoformat(timespec="seconds"))
    db.update_row("webhook_outbox", outbox_id, updated_at=db.now_iso(), **fields)
    return db.get_row("webhook_outbox", outbox_id)


def drain_outbox(now: datetime | None = None, batch: int = 50) -> int:
    """Attempt every pending delivery whose retry time has come. Called periodically by the API's worker."""
    due = db.query(
        "SELECT id FROM webhook_outbox WHERE status = 'pending' AND next_attempt_at <= ? ORDER BY next_attempt_at LIMIT ?",
        ((now or datetime.now(timezone.utc)).isoformat(timespec="seconds"), batch),
    )
    return sum(1 for r in due if attempt(r["id"]) is not None)


def recover_outbox() -> None:
    """Deliveries interrupted by a restart are left 'sending'; put them back in the queue (called at startup)."""
    db.execute("UPDATE webhook_outbox SET status = 'pending' WHERE status = 'sending'")


def outbox(status: str | None = None, limit: int = 100) -> list[dict[str, Any]]:
    sql = "SELECT o.*, w.name AS webhook_name, w.url AS webhook_url FROM webhook_outbox o LEFT JOIN webhooks w ON w.id = o.webhook_id"
    params: tuple = ()
    if status:
        sql += " WHERE o.status = ?"
        params = (status,)
    return db.query(sql + " ORDER BY o.created_at DESC, o.rowid DESC LIMIT ?", (*params, limit))  # rowid: same-second ties


def outbox_counts() -> dict[str, int]:
    return dict(db.query_pairs("SELECT status, COUNT(*) FROM webhook_outbox GROUP BY status"))


# ---------------------------------------------------------------- SSRF guard
class UnsafeDestination(ValueError):
    pass


def _is_public(ip: str) -> bool:
    addr = ipaddress.ip_address(ip)
    if isinstance(addr, ipaddress.IPv6Address) and addr.ipv4_mapped:
        addr = addr.ipv4_mapped
    return addr.is_global and not addr.is_multicast


def check_destination(url: str, resolve: bool = True) -> None:
    """Refuse URLs pointing into private networks. `resolve=False` only checks literal IPs and localhost names
    (used when saving a webhook, so validation doesn't depend on DNS being reachable)."""
    if get_settings().webhook_allow_private_networks:
        return
    host = (urlsplit(url).hostname or "").lower().rstrip(".")
    if not host or host == "localhost" or host.endswith((".localhost", ".internal", ".local")):
        raise UnsafeDestination(f"{host or 'empty host'} is not a public address")
    try:
        literal = ipaddress.ip_address(host)
    except ValueError:
        literal = None
    if literal is not None:
        if not _is_public(host):
            raise UnsafeDestination(f"{host} is a private or reserved address")
        return
    if resolve:
        try:
            infos = socket.getaddrinfo(host, None, proto=socket.IPPROTO_TCP)
        except socket.gaierror as exc:
            raise UnsafeDestination(f"Could not resolve {host}") from exc
        private = sorted({i[4][0] for i in infos if not _is_public(i[4][0])})
        if private:
            raise UnsafeDestination(f"{host} resolves to a private or reserved address ({', '.join(private)})")


def _from_sandbox(data: dict[str, Any]) -> bool:
    conversation_id = (
        data.get("conversation_id") or (data.get("ticket") or {}).get("conversation_id") or (data.get("action") or {}).get("conversation_id")
    )
    if not conversation_id:
        return False
    rows = db.query_pairs("SELECT id, sandbox FROM conversations WHERE id = ?", (conversation_id,))
    return bool(rows and rows[0][1])


def deliver(hook: dict[str, Any], envelope: dict[str, Any], attempt: int = 1, delivery_id: str | None = None) -> dict[str, Any]:
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
            "X-Relay-Attempt": str(attempt),
        }
        if delivery_id:
            headers["X-Relay-Delivery"] = delivery_id
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
    WEBHOOK_ATTEMPTS.inc(result="ok" if ok else "failed")
    return {**record, "ok": ok}


def _send(url: str, body: str, headers: dict[str, str]) -> int:
    check_destination(url)
    # No redirects: a public URL must not bounce the request into the private network.
    return httpx.post(url, content=body, headers=headers, timeout=5.0, follow_redirects=False).status_code


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
    if event == "insight.spike":
        issue = data.get("issue") or {}
        baseline = issue.get("baseline_avg") or 0
        vs = f"{issue.get('ratio')}× the usual {baseline:g}/day" if baseline else "new — not seen in the past week"
        return f":chart_with_upwards_trend: *Emerging issue:* {issue.get('label')} — {issue.get('current')} conversations in 24h ({vs})"
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

"""Customer health: who is quietly about to churn?

Every customer starts at 100 and loses points for experiences that predict churn — repeated
contacts, escalations, SLA misses, angry turns, low CSAT, denied requests, returns — over the last
30 days. The score is deliberately additive and explainable: each deduction is listed as a factor,
so a specialist sees *why* someone is at risk, not just a number.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

from . import commerce, db

WINDOW_DAYS = 30


def _factor(factors: list[dict[str, Any]], count: int, per: int, cap: int, label: str) -> None:
    if count > 0:
        impact = max(per * count, cap) if per < 0 else min(per * count, cap)
        factors.append({"label": label, "impact": impact})


def _plural(n: int, word: str) -> str:
    return f"{n} {word}{'' if n == 1 else 's'}"


def customer_health(customer_id: str, now: datetime | None = None) -> dict[str, Any] | None:
    customer = commerce.get_customer(customer_id)
    if not customer:
        return None
    now = now or datetime.now(timezone.utc)
    since = (now - timedelta(days=WINDOW_DAYS)).isoformat(timespec="seconds")

    conversations = db.query(
        "SELECT id, csat, created_at FROM conversations WHERE customer_id = ? AND sandbox = 0 AND created_at >= ?", (customer_id, since)
    )
    tickets = db.query(
        """SELECT t.status, t.sla_due_at, t.resolved_at FROM tickets t JOIN conversations c ON c.id = t.conversation_id
           WHERE t.customer_id = ? AND c.sandbox = 0 AND t.created_at >= ?""",
        (customer_id, since),
    )
    sentiments = [
        (r["meta"] or {}).get("sentiment")
        for r in db.query(
            """SELECT m.meta FROM messages m JOIN conversations c ON c.id = m.conversation_id
               WHERE c.customer_id = ? AND c.sandbox = 0 AND m.role = 'assistant' AND m.created_at >= ?""",
            (customer_id, since),
        )
    ]
    actions = db.query("SELECT type, status FROM actions WHERE customer_id = ? AND created_at >= ?", (customer_id, since))

    now_iso = now.isoformat(timespec="seconds")
    breached = sum(
        1 for t in tickets
        if t["sla_due_at"] and ((t["resolved_at"] and t["resolved_at"] > t["sla_due_at"]) or (not t["resolved_at"] and t["sla_due_at"] < now_iso))
    )
    open_tickets = sum(1 for t in tickets if t["status"] != "resolved")
    ratings = [c["csat"] for c in conversations if c["csat"] is not None]
    contacts = len(conversations)

    factors: list[dict[str, Any]] = []
    _factor(factors, contacts - 2, -6, -24, f"{_plural(contacts, 'conversation')} in {WINDOW_DAYS} days — repeat contact")
    _factor(factors, len(tickets), -8, -24, f"{_plural(len(tickets), 'escalation')} to a specialist")
    _factor(factors, open_tickets, -6, -12, f"{_plural(open_tickets, 'ticket')} still open")
    _factor(factors, breached, -12, -24, f"{_plural(breached, 'SLA')} missed")
    angry = sentiments.count("angry")
    _factor(factors, angry, -10, -20, f"angry in {_plural(angry, 'message')}")
    negative = sentiments.count("negative")
    _factor(factors, negative, -4, -12, f"frustrated in {_plural(negative, 'message')}")
    low = sum(1 for r in ratings if r <= 2)
    _factor(factors, low, -18, -36, f"{_plural(low, 'low CSAT rating')} (1–2★)")
    denied = sum(1 for a in actions if a["status"] == "denied")
    _factor(factors, denied, -12, -24, f"{_plural(denied, 'request')} denied")
    reversals = sum(1 for a in actions if a["status"] == "executed")
    _factor(factors, reversals, -4, -12, f"{_plural(reversals, 'return, refund or cancellation')}")
    happy = sum(1 for r in ratings if r >= 4)
    _factor(factors, happy, 4, 8, f"{_plural(happy, 'happy rating')} (4–5★)")

    score = max(0, min(100, 100 + sum(f["impact"] for f in factors)))
    factors.sort(key=lambda f: f["impact"])
    return {
        "customer_id": customer_id,
        "score": score,
        "risk": "high" if score < 50 else "medium" if score < 75 else "low",
        "factors": factors,
        "lifetime_value": customer.get("lifetime_value", 0),
        "window_days": WINDOW_DAYS,
    }


def at_risk_customers(limit: int = 10) -> dict[str, Any]:
    rows = []
    for customer in commerce.list_customers():
        health = customer_health(customer["id"])
        if not health or health["risk"] == "low":
            continue
        latest = db.query(
            "SELECT id FROM conversations WHERE customer_id = ? AND sandbox = 0 ORDER BY updated_at DESC, rowid DESC LIMIT 1", (customer["id"],)
        )
        rows.append({**health, "name": customer["name"], "tier": customer["tier"], "latest_conversation_id": latest[0]["id"] if latest else None})
    rows.sort(key=lambda r: (r["score"], -r["lifetime_value"]))
    return {
        "customers": rows[:limit],
        "revenue_at_risk": round(sum(r["lifetime_value"] for r in rows), 2),
        "high_risk": sum(1 for r in rows if r["risk"] == "high"),
    }

"""Business reporting: ROI, SLA performance, automation, languages and CSV exports."""

from __future__ import annotations

import csv
import io
from datetime import datetime, timezone
from typing import Any

from . import db
from .config import get_settings


def _minutes_between(start: str | None, end: str | None) -> float | None:
    if not start or not end:
        return None
    return (datetime.fromisoformat(end) - datetime.fromisoformat(start)).total_seconds() / 60


def _avg(values: list[float]) -> float | None:
    return round(sum(values) / len(values), 1) if values else None


def business_metrics(base: dict[str, Any]) -> dict[str, Any]:
    s = get_settings()
    now = datetime.now(timezone.utc)

    # ---- SLA: breached if resolved after the due time, or still open past it
    tickets = db.query(
        """SELECT t.*, (SELECT MIN(m.created_at) FROM messages m WHERE m.conversation_id = t.conversation_id
                        AND m.role = 'human_agent' AND m.created_at >= t.created_at) AS first_response_at
           FROM tickets t"""
    )
    with_sla = [t for t in tickets if t["sla_due_at"]]
    breached = [
        t for t in with_sla
        if (t["resolved_at"] and t["resolved_at"] > t["sla_due_at"]) or (not t["resolved_at"] and datetime.fromisoformat(t["sla_due_at"]) < now)
    ]
    first_response = [m for t in tickets if (m := _minutes_between(t["created_at"], t["first_response_at"])) is not None]
    resolution = [m for t in tickets if (m := _minutes_between(t["created_at"], t["resolved_at"])) is not None]

    # ---- automation
    action_rows = db.query("SELECT type, status, requested_by, decided_by, amount FROM actions")
    executed = [a for a in action_rows if a["status"] == "executed"]
    automated = [a for a in executed if a["requested_by"] == "ai" and not a["decided_by"]]
    by_type: dict[str, int] = {}
    for a in executed:
        by_type[a["type"]] = by_type.get(a["type"], 0) + 1

    # ---- ROI: every AI-resolved conversation and AI-executed action is a ticket a human didn't handle
    handled_by_ai = base["ai_resolved_conversations"] + len(automated)
    hours_saved = handled_by_ai * s.minutes_per_human_ticket / 60

    languages = dict(db.query_pairs("SELECT COALESCE(language, 'en'), COUNT(*) FROM conversations GROUP BY COALESCE(language, 'en')"))

    return {
        "roi": {
            "handled_by_ai": handled_by_ai,
            "hours_saved": round(hours_saved, 1),
            "cost_saved": round(hours_saved * s.cost_per_agent_hour, 2),
            "minutes_per_human_ticket": s.minutes_per_human_ticket,
            "cost_per_agent_hour": s.cost_per_agent_hour,
        },
        "sla": {
            "tickets_with_sla": len(with_sla),
            "breached": len(breached),
            "open_breached": sum(1 for t in breached if not t["resolved_at"]),
            "compliance_rate": round(1 - len(breached) / len(with_sla), 3) if with_sla else None,
            "avg_first_response_minutes": _avg(first_response),
            "avg_resolution_minutes": _avg(resolution),
        },
        "automation": {
            "executed_actions": len(executed),
            "automated_actions": len(automated),
            "approved_actions": sum(1 for a in executed if a["decided_by"]),
            "pending_approvals": sum(1 for a in action_rows if a["status"] == "pending_approval"),
            "denied_actions": sum(1 for a in action_rows if a["status"] == "denied"),
            "refunded_amount": round(sum(a["amount"] or 0 for a in executed if a["type"] in ("refund", "cancel_order")), 2),
            "by_type": by_type,
        },
        "languages": languages,
    }


# ---------------------------------------------------------------- CSV exports
def _csv(rows: list[dict[str, Any]], columns: list[str]) -> str:
    buffer = io.StringIO()
    writer = csv.DictWriter(buffer, fieldnames=columns, extrasaction="ignore")
    writer.writeheader()
    for row in rows:
        writer.writerow({c: _cell(row.get(c)) for c in columns})
    return buffer.getvalue()


def _cell(value: Any) -> Any:
    # Neutralize spreadsheet formula injection from customer-authored text.
    if isinstance(value, str) and value[:1] in ("=", "+", "-", "@"):
        return "'" + value
    return value


def tickets_csv() -> str:
    rows = db.query("SELECT t.*, c.language FROM tickets t LEFT JOIN conversations c ON c.id = t.conversation_id ORDER BY t.created_at DESC")
    return _csv(rows, ["id", "status", "priority", "category", "reason", "customer_id", "assignee", "confidence", "language",
                       "created_at", "sla_due_at", "resolved_at", "conversation_id", "summary"])


def conversations_csv() -> str:
    rows = db.query(
        """SELECT c.*, (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id) AS message_count
           FROM conversations c ORDER BY c.created_at DESC"""
    )
    return _csv(rows, ["id", "status", "customer_id", "title", "last_intent", "last_confidence", "language", "csat", "csat_comment",
                       "message_count", "created_at", "updated_at"])

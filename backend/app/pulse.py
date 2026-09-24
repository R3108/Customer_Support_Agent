"""Pulse: early warning for emerging support issues.

Compares the last 24 hours with the previous 7 days and flags what is surging:

* a topic (intent) — e.g. "Damaged, defective or wrong item: 9 conversations vs. 1.3/day",
  which usually means a bad batch, a carrier problem or a broken checkout step;
* negative sentiment — customers are getting angrier, whatever they're asking about;
* escalations to one team — a queue is about to be overwhelmed.

Each flagged issue fires one `insight.spike` webhook per day, so the team hears about a problem
from Slack before they hear about it from a pile of tickets.
"""

from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timedelta, timezone
from typing import Any

from . import db, webhooks
from .agents.intents import INTENTS
from .insights import redact

BASELINE_DAYS = 7
MIN_COUNT = 3  # below this, "3× more" is just noise
MIN_RATIO = 2.0
BASELINE_FLOOR = 0.5
IGNORED_INTENTS = {"greeting", "general_inquiry"}


def _day_index(created_at: str, now: datetime) -> int | None:
    """0 = the last 24h, 1 = the 24h before that, ... BASELINE_DAYS; None if older."""
    age = now - datetime.fromisoformat(created_at)
    index = int(age.total_seconds() // 86400)
    return index if 0 <= index <= BASELINE_DAYS else None


def _issue(kind: str, key: str, label: str, series: list[int], examples: list[str]) -> dict[str, Any] | None:
    current = series[-1]
    baseline_avg = round(sum(series[:-1]) / BASELINE_DAYS, 2)
    if current < MIN_COUNT:
        return None
    # Floor the baseline at 0.5/day: one contact last week shouldn't turn today's four into "28×".
    ratio = round(current / max(baseline_avg, BASELINE_FLOOR), 1) if baseline_avg else None
    if ratio is not None and ratio < MIN_RATIO:
        return None
    high = (ratio is None and current >= 5) or (ratio is not None and ratio >= 4) or current >= 10
    return {
        "id": f"{kind}:{key}", "kind": kind, "key": key, "label": label, "current": current, "baseline_avg": baseline_avg,
        "ratio": ratio, "severity": "high" if high else "medium", "series": series, "examples": examples[:3],
    }


def emerging_issues(now: datetime | None = None) -> dict[str, Any]:
    now = now or datetime.now(timezone.utc)
    since = (now - timedelta(days=BASELINE_DAYS + 1)).isoformat(timespec="seconds")
    rows = db.query(
        """SELECT m.conversation_id, m.meta, m.created_at,
                  (SELECT q.content FROM messages q WHERE q.conversation_id = m.conversation_id AND q.role = 'customer'
                   AND q.id < m.id ORDER BY q.id DESC LIMIT 1) AS question
           FROM messages m JOIN conversations c ON c.id = m.conversation_id
           WHERE m.role = 'assistant' AND c.sandbox = 0 AND m.created_at >= ?""",
        (since,),
    )
    # (kind, key) -> day -> conversations; each conversation counts once per topic per day.
    seen: dict[tuple[str, str], list[set[str]]] = defaultdict(lambda: [set() for _ in range(BASELINE_DAYS + 1)])
    examples: dict[tuple[str, str], list[str]] = defaultdict(list)
    for row in rows:
        day = _day_index(row["created_at"], now)
        if day is None:
            continue
        meta = row["meta"] or {}
        keys = []
        if (intent := meta.get("intent")) and intent not in IGNORED_INTENTS:
            keys.append(("intent", intent))
        if meta.get("sentiment") in ("negative", "angry"):
            keys.append(("sentiment", "negative"))
        for key in keys:
            seen[key][day].add(row["conversation_id"])
            question = redact(row["question"] or "").strip()
            if day == 0 and question and question not in examples[key]:
                examples[key].append(question[:160])

    for ticket in db.query(
        """SELECT t.conversation_id, t.category, t.reason, t.created_at FROM tickets t JOIN conversations c ON c.id = t.conversation_id
           WHERE c.sandbox = 0 AND t.created_at >= ?""",
        (since,),
    ):
        day = _day_index(ticket["created_at"], now)
        if day is not None and ticket["category"]:
            key = ("escalation", ticket["category"])
            seen[key][day].add(ticket["conversation_id"])
            if day == 0 and ticket["reason"] and ticket["reason"] not in examples[key]:
                examples[key].append(redact(ticket["reason"])[:160])

    issues = []
    for (kind, key), days in seen.items():
        series = [len(days[d]) for d in range(BASELINE_DAYS, -1, -1)]  # oldest -> last 24h
        label = {
            "intent": INTENTS.get(key, {}).get("label", key),
            "sentiment": "Negative or angry customers",
            "escalation": f"Escalations to {key}",
        }[kind]
        if issue := _issue(kind, key, label, series, examples[(kind, key)]):
            issues.append(issue)
    issues.sort(key=lambda i: (i["severity"] != "high", -(i["ratio"] or 99), -i["current"]))

    oldest = db.query("SELECT MIN(created_at) AS first FROM conversations WHERE sandbox = 0")[0]["first"]
    warming_up = not oldest or datetime.fromisoformat(oldest) > now - timedelta(days=1)
    return {"window_hours": 24, "baseline_days": BASELINE_DAYS, "warming_up": warming_up, "issues": issues, "generated_at": now.isoformat(timespec="seconds")}


def check_spikes(now: datetime | None = None) -> int:
    """Fire `insight.spike` once per issue per day. Quiet while there's no baseline to compare against."""
    now = now or datetime.now(timezone.utc)
    report = emerging_issues(now)
    if report["warming_up"]:
        return 0
    fired = 0
    for issue in report["issues"]:
        key = f"{issue['id']}:{now.date().isoformat()}"
        if db.query("SELECT key FROM pulse_alerts WHERE key = ?", (key,)):
            continue
        db.insert("pulse_alerts", {"key": key, "created_at": db.now_iso()})
        webhooks.emit("insight.spike", {"issue": {k: v for k, v in issue.items() if k != "series"}})
        fired += 1
    return fired

"""Privacy controls: sensitive-data redaction, GDPR/CCPA data export and erasure, and a retention policy.

Redaction runs on every customer message *before* it is stored, shown to specialists, written to agent memory
or sent to an LLM provider, so card numbers and secrets never land in the database, logs or a third party.
Detection is conservative: card numbers must pass the Luhn check and match a card-network prefix, and
passwords are only masked when the value looks like one.

Erasure anonymizes rather than deletes rows: message text, ticket notes and action parameters are wiped and
the customer link is removed, while non-personal facts (intent, confidence, outcome, timings) remain, so
analytics stay truthful after a deletion request. Agent memory (the LangGraph thread) is deleted outright.
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any

from . import audit, commerce, db
from .config import get_settings
from .observability import PII_REDACTIONS

log = logging.getLogger("relay.privacy")
ERASED = "[erased]"


# ---------------------------------------------------------------- redaction
_CARD = re.compile(r"(?<![\d-])(?:\d[ -]?){12,18}\d(?![\d-])")
_CARD_PREFIX = re.compile(r"^(?:4|5[1-5]|2[2-7]|3[47]|3(?:0[0-5]|[68])|35|6(?:011|5))")
_SSN = re.compile(r"\b(?!000|666|9\d\d)\d{3}-(?!00)\d{2}-(?!0000)\d{4}\b")
_CVV = re.compile(r"\b(cvv2?|cvc2?|csc|card security code|security code)(\s*(?:is|:|=|-)?\s*)(\d{3,4})\b", re.I)
_OTP = re.compile(
    r"\b((?:verification|security|login|sign[- ]?in|2fa|one[- ]time|otp|authentication|auth)\s+code)(\s*(?:is|:|=)?\s*)(\d{4,8})\b", re.I
)
_PIN = re.compile(r"\b(pin(?:\s+number)?)(\s*(?:is|:|=)\s*)(\d{4,8})\b", re.I)
_PASSWORD = re.compile(r"\b(password|passcode|passwd|pwd)(\s*(?:is|:|=)\s*)(\S+)", re.I)

LABELS = {
    "card_number": "card number",
    "ssn": "Social Security number",
    "cvv": "card security code",
    "one_time_code": "one-time code",
    "pin": "PIN",
    "password": "password",
}


@dataclass
class Redaction:
    text: str
    kinds: list[str] = field(default_factory=list)

    @property
    def changed(self) -> bool:
        return bool(self.kinds)


def _luhn(digits: str) -> bool:
    total = 0
    for i, ch in enumerate(reversed(digits)):
        n = int(ch)
        if i % 2:
            n = n * 2 - 9 if n > 4 else n * 2
        total += n
    return total % 10 == 0


def _looks_like_secret(value: str) -> bool:
    """'hunter2' or 'S3cure!pass' yes; 'not working' or 'expired' no."""
    value = value.strip(".,;!?\"'")
    return len(value) >= 6 and (any(c.isdigit() for c in value) or not value.isalnum() or any(c.isupper() for c in value[1:]))


def redact(text: str) -> Redaction:
    kinds: list[str] = []

    def card(m: re.Match[str]) -> str:
        digits = re.sub(r"\D", "", m.group(0))
        if 13 <= len(digits) <= 19 and _CARD_PREFIX.match(digits) and _luhn(digits):
            kinds.append("card_number")
            return f"[card ending {digits[-4:]}]"
        return m.group(0)

    def labelled(kind: str, check: Any = None):
        def sub(m: re.Match[str]) -> str:
            if check and not check(m.group(3)):
                return m.group(0)
            kinds.append(kind)
            return f"{m.group(1)}{m.group(2)}[redacted]"
        return sub

    out = _CARD.sub(card, text)
    out, n = _SSN.subn("[SSN redacted]", out)
    kinds.extend(["ssn"] * n)
    out = _CVV.sub(labelled("cvv"), out)
    out = _OTP.sub(labelled("one_time_code"), out)
    out = _PIN.sub(labelled("pin"), out)
    out = _PASSWORD.sub(labelled("password", _looks_like_secret), out)
    for kind in kinds:
        PII_REDACTIONS.inc(kind=kind)
    return Redaction(out, list(dict.fromkeys(kinds)))


def redaction_notice(kinds: list[str]) -> str:
    names = [LABELS[k] for k in kinds]
    shared = names[0] if len(names) == 1 else ", ".join(names[:-1]) + " and " + names[-1]
    return (f"For your security, I've hidden the {shared} you shared — it isn't stored or seen by anyone. "
            "We'll never ask for full card details, passwords or one-time codes in chat.")


# ---------------------------------------------------------------- export & erasure
# Assistant-reply metadata that describes *how* the AI handled a turn, not the person; kept after erasure.
SAFE_META = {"intent", "intent_label", "intent_confidence", "sentiment", "confidence", "action", "escalated",
             "escalation_reason", "mode", "latency_ms", "route", "language", "usage", "retrieval_confidence"}


def export_customer(customer_id: str) -> dict[str, Any] | None:
    """Everything Relay holds about a customer, as one JSON document (data-subject access request)."""
    customer = commerce.get_customer(customer_id)
    if not customer:
        return None
    conversations = db.query("SELECT * FROM conversations WHERE customer_id = ? AND sandbox = 0 ORDER BY created_at", (customer_id,))
    return {
        "generated_at": db.now_iso(),
        "customer": customer,
        "conversations": [
            {
                **conv,
                "messages": db.list_messages(conv["id"]),
                "tickets": db.query("SELECT * FROM tickets WHERE conversation_id = ? ORDER BY created_at", (conv["id"],)),
                "actions": db.query("SELECT * FROM actions WHERE conversation_id = ? ORDER BY created_at", (conv["id"],)),
            }
            for conv in conversations
        ],
    }


def erase_conversations(conversation_ids: list[str]) -> dict[str, int]:
    """Anonymize conversations in place and delete their agent memory. Idempotent."""
    from .agents.graph import get_graph

    counts = {"conversations": 0, "messages": 0, "tickets": 0, "actions": 0}
    ts = db.now_iso()
    for cid in conversation_ids:
        messages = db.query("SELECT id, meta FROM messages WHERE conversation_id = ?", (cid,))
        for m in messages:
            safe = {k: v for k, v in (m["meta"] or {}).items() if k in SAFE_META}
            db.update_row("messages", m["id"], content=ERASED, meta=safe)
        counts["messages"] += len(messages)
        counts["tickets"] += db.execute(
            "UPDATE tickets SET customer_id = NULL, reason = ?, summary = NULL, suggested_reply = NULL, updated_at = ? WHERE conversation_id = ?",
            (ERASED, ts, cid),
        ).rowcount
        counts["actions"] += db.execute(
            "UPDATE actions SET customer_id = NULL, params = '{}', result = '{}', decision_note = NULL, updated_at = ? WHERE conversation_id = ?",
            (ts, cid),
        ).rowcount
        counts["conversations"] += db.execute(
            "UPDATE conversations SET customer_id = NULL, title = ?, csat_comment = NULL, erased_at = ?, updated_at = ? WHERE id = ?",
            (ERASED, ts, ts, cid),
        ).rowcount
        try:
            get_graph().checkpointer.delete_thread(cid)
        except Exception:  # noqa: BLE001 - reported, but the rest of the erasure stands
            log.exception("Could not delete agent memory for %s", cid)
    return counts


def erase_customer(customer_id: str) -> dict[str, int]:
    ids = [r["id"] for r in db.query("SELECT id FROM conversations WHERE customer_id = ? AND sandbox = 0", (customer_id,))]
    return erase_conversations(ids)


# ---------------------------------------------------------------- retention
def apply_retention(now: datetime | None = None, batch: int = 500) -> int:
    """Anonymize closed conversations untouched for `retention_days`. Open escalations are never touched."""
    days = get_settings().retention_days
    if days <= 0:
        return 0
    cutoff = ((now or datetime.now(timezone.utc)) - timedelta(days=days)).isoformat(timespec="seconds")
    ids = [r["id"] for r in db.query(
        "SELECT id FROM conversations WHERE sandbox = 0 AND erased_at IS NULL AND updated_at < ? AND status != 'escalated' "
        "AND id NOT IN (SELECT conversation_id FROM tickets WHERE status != 'resolved') LIMIT ?",
        (cutoff, batch),
    )]
    if ids:
        counts = erase_conversations(ids)
        audit.record("retention.purge", "conversation", None, {**counts, "cutoff": cutoff, "retention_days": days},
                     actor="retention-policy", actor_kind="system")
    return len(ids)

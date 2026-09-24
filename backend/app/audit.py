"""Tamper-evident audit log of privileged actions.

Each entry stores the SHA-256 of its own contents plus the previous entry's hash, forming a chain: editing,
deleting or reordering any past entry breaks every hash after it, which ``verify()`` detects. (Someone with
write access could rebuild the whole chain; ship entries to append-only storage or a SIEM for stronger
guarantees — the webhook outbox is a natural transport.)

Who, from where and in which request come from the request context, so call sites only say *what* happened.
"""

from __future__ import annotations

import hashlib
import json
import logging
from typing import Any

from . import db, observability

log = logging.getLogger("relay.audit")
GENESIS = "0" * 64
_HASHED = ("created_at", "actor", "actor_kind", "action", "target_type", "target_id", "ip", "request_id", "details", "prev_hash")


def _digest(entry: dict[str, Any]) -> str:
    canonical = json.dumps({k: entry.get(k) for k in _HASHED}, sort_keys=True, separators=(",", ":"), default=str)
    return hashlib.sha256(canonical.encode()).hexdigest()


def record(action: str, target_type: str | None = None, target_id: str | None = None,
           details: dict[str, Any] | None = None, actor: str | None = None, actor_kind: str | None = None) -> None:
    """Append an entry. Never raises: failing to audit must not fail the action it describes (it's logged loudly)."""
    ctx = observability.current()
    entry: dict[str, Any] = {
        "created_at": db.now_iso(),
        "actor": actor or (ctx.actor if ctx else None) or "system",
        "actor_kind": actor_kind or (ctx.actor_kind if ctx else None) or "system",
        "action": action,
        "target_type": target_type,
        # Normalized to what SQLite hands back (TEXT column, JSON round-trip) so verify() recomputes the same hash.
        "target_id": str(target_id) if target_id is not None else None,
        "ip": ctx.ip if ctx else None,
        "request_id": ctx.request_id if ctx else None,
        "details": json.loads(json.dumps(details or {}, default=str)),
    }
    try:
        with db.exclusive():  # read the chain head and append atomically, or two writers would fork the chain
            head = db.query_pairs("SELECT id, hash FROM audit_log ORDER BY id DESC LIMIT 1")
            entry["prev_hash"] = head[0][1] if head else GENESIS
            entry["hash"] = _digest(entry)
            db.insert("audit_log", entry)
    except Exception:  # noqa: BLE001
        log.exception("Could not write audit entry %s %s/%s", action, target_type, target_id)


def list_entries(action: str | None = None, actor: str | None = None, target_type: str | None = None,
                 target_id: str | None = None, before_id: int | None = None, limit: int = 100) -> list[dict[str, Any]]:
    clauses, params = [], []
    for column, value in (("actor", actor), ("target_type", target_type), ("target_id", target_id)):
        if value:
            clauses.append(f"{column} = ?")
            params.append(value)
    if action:
        # "action.*" matches a whole family (action.approve, action.deny…).
        clauses.append("action LIKE ?" if action.endswith(".*") else "action = ?")
        params.append(action[:-1] + "%" if action.endswith(".*") else action)
    if before_id:
        clauses.append("id < ?")
        params.append(before_id)
    where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
    return db.query(f"SELECT * FROM audit_log {where} ORDER BY id DESC LIMIT ?", (*params, limit))


def verify() -> dict[str, Any]:
    """Recompute the chain. Reports the first entry whose hash or link doesn't match."""
    prev = GENESIS
    count = 0
    for entry in db.query("SELECT * FROM audit_log ORDER BY id"):
        count += 1
        if entry["prev_hash"] != prev:
            return {"ok": False, "entries": count, "broken_at": entry["id"], "reason": "link to the previous entry is broken (entry removed or reordered)"}
        if _digest(entry) != entry["hash"]:
            return {"ok": False, "entries": count, "broken_at": entry["id"], "reason": "entry contents were modified"}
        prev = entry["hash"]
    return {"ok": True, "entries": count, "broken_at": None, "reason": None, "head": prev}

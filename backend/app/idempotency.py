"""Idempotency keys for retry-safe writes (the Stripe model).

A client that sends `Idempotency-Key: <unique value>` can retry a request after a timeout or dropped
connection without doing the work twice: the first request's response is stored and replayed for the same key.
Reusing a key with a different body is rejected, and a retry that arrives while the first attempt is still
running gets 409 instead of a duplicate. Keys expire after 24 hours.
"""

from __future__ import annotations

import hashlib
import json
import re
import sqlite3
from collections.abc import Callable
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import HTTPException

from . import db

HEADER = "Idempotency-Key"
TTL = timedelta(hours=24)
_VALID = re.compile(r"^[A-Za-z0-9_.:-]{8,255}$")


def run(scope: str, key: str, payload: dict[str, Any], work: Callable[[], dict[str, Any]]) -> tuple[dict[str, Any], bool]:
    """Run `work` once per (scope, key). Returns (response, replayed)."""
    if not _VALID.match(key):
        raise HTTPException(400, f"{HEADER} must be 8–255 characters: letters, digits, '_', '-', '.', ':'")
    full_key = f"{scope}:{key}"
    request_hash = hashlib.sha256(json.dumps(payload, sort_keys=True, default=str).encode()).hexdigest()
    try:
        db.insert("idempotency_keys", {"key": full_key, "request_hash": request_hash, "status": "processing", "created_at": db.now_iso()})
    except sqlite3.IntegrityError:
        existing = db.query("SELECT * FROM idempotency_keys WHERE key = ?", (full_key,))[0]
        if existing["request_hash"] != request_hash:
            raise HTTPException(422, f"This {HEADER} was already used with a different request") from None
        if existing["status"] != "done":
            raise HTTPException(409, "A request with this idempotency key is still being processed") from None
        return existing["response"], True
    try:
        response = work()
    except BaseException:
        db.execute("DELETE FROM idempotency_keys WHERE key = ?", (full_key,))  # failed attempts may be retried
        raise
    db.execute("UPDATE idempotency_keys SET status = 'done', response = ? WHERE key = ?", (json.dumps(response, default=str), full_key))
    return json.loads(json.dumps(response, default=str)), False


def purge_expired(now: datetime | None = None) -> int:
    cutoff = ((now or datetime.now(timezone.utc)) - TTL).isoformat(timespec="seconds")
    return db.execute("DELETE FROM idempotency_keys WHERE created_at < ?", (cutoff,)).rowcount

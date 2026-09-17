"""SQLite persistence for product records: conversations, messages, tickets and feedback.

Agent working memory (message history, extracted entities, summaries) lives in the
LangGraph checkpointer; this module stores what the product UI, human console and
analytics need.
"""

from __future__ import annotations

import json
import sqlite3
import threading
import uuid
from datetime import datetime, timezone
from typing import Any

from .config import get_settings

_lock = threading.RLock()
_conn: sqlite3.Connection | None = None

SCHEMA = """
CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY,
    customer_id TEXT,
    status TEXT NOT NULL DEFAULT 'ai',          -- ai | escalated | resolved
    title TEXT,
    last_intent TEXT,
    last_confidence REAL,
    csat INTEGER,
    csat_comment TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id TEXT NOT NULL REFERENCES conversations(id),
    role TEXT NOT NULL,                          -- customer | assistant | human_agent | system
    content TEXT NOT NULL,
    meta TEXT,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id, id);
CREATE TABLE IF NOT EXISTS tickets (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL REFERENCES conversations(id),
    customer_id TEXT,
    status TEXT NOT NULL DEFAULT 'open',         -- open | in_progress | resolved
    priority TEXT NOT NULL,                      -- low | normal | high | urgent
    category TEXT,
    reason TEXT,
    summary TEXT,
    suggested_reply TEXT,
    confidence REAL,
    assignee TEXT,
    sla_due_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    resolved_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets(status);
CREATE TABLE IF NOT EXISTS workspace_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,                         -- JSON
    updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS order_state (
    order_id TEXT PRIMARY KEY,
    patch TEXT NOT NULL,                         -- JSON fields layered over the commerce source record
    updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS actions (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,                          -- cancel_order | start_return | refund
    status TEXT NOT NULL,                        -- pending_approval | executed | denied | failed
    conversation_id TEXT,
    ticket_id TEXT,
    customer_id TEXT,
    order_id TEXT,
    amount REAL,
    params TEXT,
    result TEXT,
    requested_by TEXT NOT NULL,                  -- ai | <specialist name>
    decided_by TEXT,
    decision_note TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    decided_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_actions_status ON actions(status);
CREATE TABLE IF NOT EXISTS macros (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS webhooks (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    url TEXT NOT NULL,
    kind TEXT NOT NULL,                          -- generic | slack
    events TEXT NOT NULL,                        -- JSON list
    secret TEXT,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS webhook_deliveries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    webhook_id TEXT NOT NULL,
    event TEXT NOT NULL,
    ok INTEGER NOT NULL,
    status_code INTEGER,
    error TEXT,
    duration_ms INTEGER,
    created_at TEXT NOT NULL
);
"""

# Columns added after the first release; applied to existing databases on startup.
MIGRATIONS: list[tuple[str, str, str]] = [
    ("conversations", "language", "TEXT"),
    ("tickets", "sla_breach_notified", "INTEGER NOT NULL DEFAULT 0"),
]
JSON_COLUMNS = {"meta", "params", "result", "events", "patch", "value"}

DEFAULT_MACROS = [
    ("Order delay apology", "Hi {first_name}, I'm sorry {order_id} is taking longer than expected. I've opened a trace with the carrier and "
     "will update you within 24 hours. Thanks for your patience!"),
    ("Refund approved", "Hi {first_name}, good news: your refund for {order_id} has been approved. It will appear on your original "
     "payment method within 5–10 business days."),
    ("Need more details", "Hi {first_name}, thanks for reaching out! Could you share a photo of the issue and confirm the order number? "
     "That'll help me get this sorted quickly."),
    ("Closing follow-up", "Is there anything else I can help you with today, {first_name}? If not, I'll close this conversation. "
     "— {agent_name}, {company_name} Support"),
]


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def conn() -> sqlite3.Connection:
    global _conn
    with _lock:
        if _conn is None:
            path = get_settings().database_path
            path.parent.mkdir(parents=True, exist_ok=True)
            _conn = sqlite3.connect(path, check_same_thread=False)
            _conn.row_factory = sqlite3.Row
            _conn.execute("PRAGMA journal_mode=WAL")
            _conn.executescript(SCHEMA)
            _migrate(_conn)
        return _conn


def _migrate(c: sqlite3.Connection) -> None:
    for table, column, decl in MIGRATIONS:
        existing = {row[1] for row in c.execute(f"PRAGMA table_info({table})")}
        if column not in existing:
            c.execute(f"ALTER TABLE {table} ADD COLUMN {column} {decl}")
    if c.execute("SELECT COUNT(*) FROM workspace_settings WHERE key = 'macros_seeded'").fetchone()[0] == 0:
        ts = now_iso()
        for title, body in DEFAULT_MACROS:
            c.execute("INSERT INTO macros (id, title, body, created_at, updated_at) VALUES (?,?,?,?,?)",
                      (f"mac_{uuid.uuid4().hex[:8]}", title, body, ts, ts))
        c.execute("INSERT INTO workspace_settings (key, value, updated_at) VALUES ('macros_seeded', 'true', ?)", (ts,))
    c.commit()


def _row(r: sqlite3.Row | None) -> dict[str, Any] | None:
    if r is None:
        return None
    d = dict(r)
    for key in JSON_COLUMNS & d.keys():
        d[key] = json.loads(d[key]) if d[key] else ({} if key != "events" else [])
    return d


def insert(table: str, record: dict[str, Any]) -> None:
    values = tuple(json.dumps(v) if k in JSON_COLUMNS and v is not None else v for k, v in record.items())
    _execute(f"INSERT INTO {table} ({', '.join(record)}) VALUES ({', '.join('?' for _ in record)})", values)


def update_row(table: str, row_id: str, **fields: Any) -> None:
    if not fields:
        return
    values = tuple(json.dumps(v) if k in JSON_COLUMNS and v is not None else v for k, v in fields.items())
    _execute(f"UPDATE {table} SET {', '.join(f'{k} = ?' for k in fields)} WHERE id = ?", (*values, row_id))


def get_row(table: str, row_id: str) -> dict[str, Any] | None:
    rows = _query(f"SELECT * FROM {table} WHERE id = ?", (row_id,))
    return rows[0] if rows else None


def query(sql: str, params: tuple = ()) -> list[dict[str, Any]]:
    return _query(sql, params)


def query_pairs(sql: str, params: tuple = ()) -> list[tuple[Any, Any]]:
    with _lock:
        return [tuple(r) for r in conn().execute(sql, params).fetchall()]


def execute(sql: str, params: tuple = ()) -> sqlite3.Cursor:
    return _execute(sql, params)


# ---------------------------------------------------------------- workspace settings & order state
def load_workspace_settings() -> dict[str, Any]:
    return {r["key"]: r["value"] for r in _query("SELECT key, value FROM workspace_settings WHERE key != 'macros_seeded'")}


def save_workspace_settings(values: dict[str, Any]) -> None:
    ts = now_iso()
    with _lock:
        c = conn()
        for key, value in values.items():
            c.execute(
                "INSERT INTO workspace_settings (key, value, updated_at) VALUES (?,?,?) "
                "ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
                (key, json.dumps(value), ts),
            )
        c.commit()


def order_patches() -> dict[str, dict[str, Any]]:
    return {r["order_id"]: r["patch"] for r in _query("SELECT order_id, patch FROM order_state")}


def save_order_patch(order_id: str, patch: dict[str, Any]) -> None:
    _execute(
        "INSERT INTO order_state (order_id, patch, updated_at) VALUES (?,?,?) "
        "ON CONFLICT(order_id) DO UPDATE SET patch = excluded.patch, updated_at = excluded.updated_at",
        (order_id, json.dumps(patch), now_iso()),
    )


def _execute(sql: str, params: tuple = ()) -> sqlite3.Cursor:
    with _lock:
        c = conn()
        cur = c.execute(sql, params)
        c.commit()
        return cur


def _query(sql: str, params: tuple = ()) -> list[dict[str, Any]]:
    with _lock:
        return [_row(r) for r in conn().execute(sql, params).fetchall()]  # type: ignore[misc]


# ---------------------------------------------------------------- conversations
def create_conversation(customer_id: str | None, title: str | None = None) -> dict[str, Any]:
    cid = f"conv_{uuid.uuid4().hex[:12]}"
    ts = now_iso()
    _execute(
        "INSERT INTO conversations (id, customer_id, status, title, created_at, updated_at) VALUES (?,?,?,?,?,?)",
        (cid, customer_id, "ai", title, ts, ts),
    )
    return get_conversation(cid)  # type: ignore[return-value]


def get_conversation(conversation_id: str) -> dict[str, Any] | None:
    rows = _query("SELECT * FROM conversations WHERE id = ?", (conversation_id,))
    return rows[0] if rows else None


def update_conversation(conversation_id: str, **fields: Any) -> None:
    if not fields:
        return
    fields["updated_at"] = now_iso()
    cols = ", ".join(f"{k} = ?" for k in fields)
    _execute(f"UPDATE conversations SET {cols} WHERE id = ?", (*fields.values(), conversation_id))


def list_conversations(status: str | None = None, limit: int = 100) -> list[dict[str, Any]]:
    sql = """
        SELECT c.*,
               (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id) AS message_count,
               (SELECT content FROM messages m WHERE m.conversation_id = c.id ORDER BY id DESC LIMIT 1) AS last_message
        FROM conversations c
    """
    params: tuple = ()
    if status:
        sql += " WHERE c.status = ?"
        params = (status,)
    sql += " ORDER BY c.updated_at DESC LIMIT ?"
    return _query(sql, (*params, limit))


# ---------------------------------------------------------------- messages
def add_message(conversation_id: str, role: str, content: str, meta: dict | None = None) -> dict[str, Any]:
    cur = _execute(
        "INSERT INTO messages (conversation_id, role, content, meta, created_at) VALUES (?,?,?,?,?)",
        (conversation_id, role, content, json.dumps(meta or {}), now_iso()),
    )
    update_conversation(conversation_id)
    return _query("SELECT * FROM messages WHERE id = ?", (cur.lastrowid,))[0]


def list_messages(conversation_id: str, after_id: int = 0) -> list[dict[str, Any]]:
    return _query(
        "SELECT * FROM messages WHERE conversation_id = ? AND id > ? ORDER BY id",
        (conversation_id, after_id),
    )


# ---------------------------------------------------------------- tickets
def create_ticket(**fields: Any) -> dict[str, Any]:
    tid = f"TCK-{uuid.uuid4().hex[:6].upper()}"
    ts = now_iso()
    record = {"id": tid, "status": "open", "created_at": ts, "updated_at": ts, **fields}
    cols = ", ".join(record)
    _execute(
        f"INSERT INTO tickets ({cols}) VALUES ({', '.join('?' for _ in record)})",
        tuple(record.values()),
    )
    return get_ticket(tid)  # type: ignore[return-value]


def get_ticket(ticket_id: str) -> dict[str, Any] | None:
    rows = _query("SELECT * FROM tickets WHERE id = ?", (ticket_id,))
    return rows[0] if rows else None


def open_ticket_for_conversation(conversation_id: str) -> dict[str, Any] | None:
    rows = _query(
        "SELECT * FROM tickets WHERE conversation_id = ? AND status != 'resolved' ORDER BY created_at DESC LIMIT 1",
        (conversation_id,),
    )
    return rows[0] if rows else None


def update_ticket(ticket_id: str, **fields: Any) -> None:
    fields["updated_at"] = now_iso()
    cols = ", ".join(f"{k} = ?" for k in fields)
    _execute(f"UPDATE tickets SET {cols} WHERE id = ?", (*fields.values(), ticket_id))


def list_tickets(status: str | None = None) -> list[dict[str, Any]]:
    order = """ORDER BY CASE priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END,
                        created_at ASC"""
    if status:
        return _query(f"SELECT * FROM tickets WHERE status = ? {order}", (status,))
    return _query(f"SELECT * FROM tickets {order}")


# ---------------------------------------------------------------- analytics
def analytics() -> dict[str, Any]:
    with _lock:
        c = conn()
        total_convs = c.execute("SELECT COUNT(*) FROM conversations").fetchone()[0]
        escalated_convs = c.execute(
            "SELECT COUNT(DISTINCT conversation_id) FROM tickets"
        ).fetchone()[0]
        open_tickets = c.execute("SELECT COUNT(*) FROM tickets WHERE status != 'resolved'").fetchone()[0]
        resolved_tickets = c.execute("SELECT COUNT(*) FROM tickets WHERE status = 'resolved'").fetchone()[0]
        csat = c.execute("SELECT AVG(csat), COUNT(csat) FROM conversations WHERE csat IS NOT NULL").fetchone()
        ai_msgs = c.execute("SELECT meta FROM messages WHERE role = 'assistant'").fetchall()
        tickets_by_priority = dict(
            c.execute("SELECT priority, COUNT(*) FROM tickets GROUP BY priority").fetchall()
        )
        tickets_by_reason = dict(
            c.execute("SELECT category, COUNT(*) FROM tickets GROUP BY category").fetchall()
        )
        daily = c.execute(
            """SELECT substr(created_at, 1, 10) AS day, COUNT(*) FROM conversations
               GROUP BY day ORDER BY day DESC LIMIT 14"""
        ).fetchall()

    intents: dict[str, int] = {}
    confidences: list[float] = []
    latencies: list[float] = []
    buckets = {"0-40": 0, "40-60": 0, "60-80": 0, "80-100": 0}
    for (meta_json,) in ai_msgs:
        meta = json.loads(meta_json or "{}")
        if meta.get("intent"):
            intents[meta["intent"]] = intents.get(meta["intent"], 0) + 1
        if isinstance(meta.get("confidence"), (int, float)):
            conf = float(meta["confidence"])
            confidences.append(conf)
            key = "0-40" if conf < 0.4 else "40-60" if conf < 0.6 else "60-80" if conf < 0.8 else "80-100"
            buckets[key] += 1
        if isinstance(meta.get("latency_ms"), (int, float)):
            latencies.append(float(meta["latency_ms"]))

    return {
        "total_conversations": total_convs,
        "ai_resolved_conversations": max(total_convs - escalated_convs, 0),
        "escalated_conversations": escalated_convs,
        "deflection_rate": round((total_convs - escalated_convs) / total_convs, 3) if total_convs else 0,
        "open_tickets": open_tickets,
        "resolved_tickets": resolved_tickets,
        "ai_replies": len(ai_msgs),
        "avg_confidence": round(sum(confidences) / len(confidences), 3) if confidences else None,
        "avg_latency_ms": round(sum(latencies) / len(latencies)) if latencies else None,
        "csat_avg": round(csat[0], 2) if csat[0] is not None else None,
        "csat_count": csat[1],
        "intents": dict(sorted(intents.items(), key=lambda kv: -kv[1])),
        "confidence_buckets": buckets,
        "tickets_by_priority": tickets_by_priority,
        "tickets_by_category": tickets_by_reason,
        "conversations_per_day": [{"day": d, "count": n} for d, n in reversed(daily)],
    }

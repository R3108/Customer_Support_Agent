"""Relay API: customer chat, human-agent console, knowledge base and analytics."""

from __future__ import annotations

import asyncio
import hmac
import json
import logging
import math
import re
import threading
import time
from collections import defaultdict, deque
from collections.abc import AsyncIterator, Callable, Iterator
from contextlib import asynccontextmanager, suppress
from typing import Any, Literal

from fastapi import Depends, FastAPI, Header, HTTPException, Request, Response
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from langchain_core.messages import HumanMessage
from pydantic import BaseModel, Field

from . import (actions, audit, auth, commerce, db, evals, events, idempotency, insights, observability, privacy, pulse, reporting,
               webhooks, workspace)
from .auth import Principal, actor_name
from .auth_api import router as auth_router
from .agents.graph import NODE_LABELS, get_graph
from .agents.intents import INTENTS
from .agents.state import TURN_RESET
from .config import get_settings
from .deps import require_admin, require_agent
from .health import customer_health
from .llm import Usage, breaker, model_name, resolve_provider, track_usage
from .observability import AGENT_NODE_LATENCY, CHAT_TURNS, Gauge
from .product_api import router as product_router
from .rag import get_retriever
from .rag.ingest import SAFE_DOC_ID, render_markdown
from .support_ops import graph_config, post_specialist_message, resolve_ticket

observability.configure_logging()
log = logging.getLogger("relay.api")
settings = get_settings()


async def _every(seconds: Callable[[], float], jobs: tuple[tuple[str, Callable[[], Any]], ...]) -> None:
    """Run blocking maintenance jobs on a fixed cadence, off the event loop. One failing job never stops the others."""
    while True:
        await asyncio.sleep(seconds())
        for name, job in jobs:
            try:
                await run_in_threadpool(job)
            except Exception:  # noqa: BLE001
                log.exception("%s job failed", name)


@asynccontextmanager
async def lifespan(_: FastAPI):
    db.conn()
    workspace.apply_overrides()
    evals.seed_builtin_scenarios()
    evals.recover_interrupted_runs()
    webhooks.recover_outbox()
    retriever = get_retriever()
    get_graph()
    workers = [
        asyncio.create_task(_every(lambda: settings.sla_check_interval_seconds, (
            ("SLA", webhooks.check_sla_breaches), ("Pulse", pulse.check_spikes),
            ("Retention", privacy.apply_retention), ("Idempotency purge", idempotency.purge_expired),
        ))),
        asyncio.create_task(_every(lambda: settings.webhook_retry_poll_seconds, (("Webhook outbox", webhooks.drain_outbox),))),
    ]
    log.info("Relay ready · provider=%s · kb=%d docs/%d chunks", resolve_provider(), len(retriever.documents), len(retriever.chunks))
    yield
    for worker in workers:
        worker.cancel()
    for worker in workers:
        with suppress(asyncio.CancelledError):
            await worker


app = FastAPI(title="Relay Support API", version="1.1.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["Content-Disposition", "X-Request-ID", "Idempotent-Replayed", "Retry-After",
                    "RateLimit-Limit", "RateLimit-Remaining", "RateLimit-Reset"],
)
app.add_middleware(observability.ObservabilityMiddleware)  # added last = outermost: sees every request, incl. CORS preflights
app.include_router(auth_router)
app.include_router(product_router)

# Scrape-time gauges.
Gauge("relay_webhook_outbox", "Webhook outbox entries by status.", ("status",),
      fn=lambda: {(status,): n for status, n in webhooks.outbox_counts().items()})
Gauge("relay_live_subscribers", "Consoles connected to the live event stream.", fn=lambda: {(): events.subscriber_count()})
Gauge("relay_llm_circuit_open", "1 while the LLM circuit breaker is open or half-open.", fn=lambda: {(): int(breaker.state != "closed")})
Gauge("relay_info", "Build and engine information.", ("version", "provider"), fn=lambda: {(app.version, resolve_provider()): 1})


# ------------------------------------------------------------------ security helpers
_rate: dict[str, deque[float]] = defaultdict(deque)
_rate_lock = threading.Lock()
RATE_WINDOW = 60.0


def rate_limit(request: Request, response: Response) -> None:
    """Sliding-window limit per client IP, advertised with the IETF RateLimit-* headers."""
    ctx = observability.current()
    key = (ctx.ip if ctx else None) or (request.client.host if request.client else None) or "anonymous"
    limit = settings.chat_rate_limit_per_minute
    now = time.monotonic()
    with _rate_lock:
        bucket = _rate[key]
        while bucket and now - bucket[0] > RATE_WINDOW:
            bucket.popleft()
        if len(bucket) >= limit:
            retry = max(1, math.ceil(RATE_WINDOW - (now - bucket[0])))
            raise HTTPException(429, "Too many messages — please wait a moment.", headers={
                "Retry-After": str(retry), "RateLimit-Limit": str(limit), "RateLimit-Remaining": "0", "RateLimit-Reset": str(retry),
            })
        bucket.append(now)
        remaining, reset = limit - len(bucket), math.ceil(RATE_WINDOW - (now - bucket[0]))
        # Drop idle buckets so a stream of one-off IPs can't grow memory forever (amortized: only when it's big).
        if len(_rate) > 5000:
            for stale in [k for k, b in _rate.items() if not b or now - b[-1] > RATE_WINDOW]:
                del _rate[stale]
    response.headers.update({"RateLimit-Limit": str(limit), "RateLimit-Remaining": str(remaining), "RateLimit-Reset": str(reset)})


# ------------------------------------------------------------------ schemas
class ChatRequest(BaseModel):
    message: str = Field(min_length=1, max_length=4000)
    conversation_id: str | None = None
    customer_id: str | None = None


class FeedbackRequest(BaseModel):
    rating: int = Field(ge=1, le=5)
    comment: str | None = Field(default=None, max_length=2000)


class TicketReply(BaseModel):
    content: str = Field(min_length=1, max_length=8000)
    agent_name: str = Field(default="Support Specialist", max_length=80)
    resolve: bool = False


class TicketPatch(BaseModel):
    status: Literal["open", "in_progress", "resolved"] | None = None
    priority: Literal["low", "normal", "high", "urgent"] | None = None
    assignee: str | None = Field(default=None, max_length=80)


class KBDocument(BaseModel):
    title: str = Field(min_length=2, max_length=120)
    category: str = Field(default="general", pattern=r"^[a-z0-9_-]{1,40}$")
    body: str = Field(min_length=10, max_length=100_000)


class SearchRequest(BaseModel):
    query: str = Field(min_length=1, max_length=500)
    top_k: int = Field(default=5, ge=1, le=10)


# ------------------------------------------------------------------ chat engine
_graph_config = graph_config
HIDDEN_ENTITIES = {"active_order_source", "pending_action", "language"}


def _step_payload(node: str, update: dict[str, Any]) -> dict[str, Any]:
    """Public, UI-friendly trace of what each agent did."""
    data: dict[str, Any] = {}
    if node == "intent_classifier":
        signals = update.get("signals") or {}
        data = {
            "intent": update.get("intent"),
            "intent_label": INTENTS.get(update.get("intent", ""), {}).get("label"),
            "confidence": update.get("intent_confidence"),
            "sentiment": update.get("sentiment"),
            "urgency": update.get("urgency"),
            "language": update.get("language"),
            "query": update.get("standalone_query"),
            "entities": {k: v for k, v in (update.get("entities") or {}).items() if k not in HIDDEN_ENTITIES},
            "hard_triggers": signals.get("hard_triggers", []),
            "action_confirmation": signals.get("action_confirmation"),
            "signals": [k for k in signals if k not in ("hard_triggers", "mentioned_order_ids", "text", "action_confirmation")],
            "mode": update.get("mode"),
        }
    elif node == "knowledge_retriever":
        ctx = update.get("account_context") or {}
        data = {
            "retrieval_confidence": update.get("retrieval_confidence"),
            "sources": [{k: d[k] for k in ("id", "title", "section", "score")} for d in update.get("retrieved_docs", [])],
            "account": {
                "authenticated": ctx.get("authenticated"),
                "order_lookup": ctx.get("order_lookup"),
                "candidate_orders": len(ctx.get("candidate_orders") or []),
            } if ctx else None,
        }
    elif node == "support_agent":
        data = {
            "action": update.get("action"),
            "confidence": update.get("confidence"),
            "breakdown": update.get("confidence_breakdown"),
            "escalate": update.get("escalate"),
            "escalation_reason": update.get("escalation_reason"),
            "cited_sources": update.get("cited_sources"),
            "mode": update.get("mode"),
            "action_proposal": update.get("action_proposal"),
            "knowledge_gap": update.get("knowledge_gap"),
        }
    elif node == "action_agent":
        breakdown = update.get("confidence_breakdown") or {}
        data = {
            "decision": breakdown.get("action_confirmation"),
            "action": update.get("action_result"),
            "escalate": bool(update.get("escalate")),
        }
    elif node == "escalation_agent":
        ticket = update.get("ticket") or {}
        data = {
            "ticket_id": ticket.get("id"),
            "priority": ticket.get("priority"),
            "team": ticket.get("category"),
            "reason": ticket.get("reason"),
            "priority_rationale": ticket.get("priority_rationale"),
            "approval": update.get("action_result"),
        }
    elif node == "memory_manager":
        remembered = {k: v for k, v in (update.get("entities") or {}).items() if k not in HIDDEN_ENTITIES}
        data = {"summarized": "memory_summary" in update, "remembered": remembered}
    return {"node": node, "label": NODE_LABELS.get(node, node), "data": data}


def _ensure_conversation(req: ChatRequest) -> dict[str, Any]:
    if req.customer_id and not commerce.get_customer(req.customer_id):
        raise HTTPException(status_code=404, detail="Unknown customer")
    if req.conversation_id:
        conv = db.get_conversation(req.conversation_id)
        if conv is None:
            raise HTTPException(status_code=404, detail="Conversation not found")
        if conv["customer_id"] != req.customer_id:
            raise HTTPException(status_code=403, detail="Conversation belongs to a different customer")
        return conv
    title = re.sub(r"\s+", " ", req.message).strip()[:80]
    return db.create_conversation(req.customer_id, title)


def _outcome(state: dict[str, Any]) -> str:
    if state.get("escalate"):
        return "escalated"
    if (state.get("action_result") or {}).get("status") == "executed":
        return "action_executed"
    return "clarified" if state.get("action") == "clarify" else "answered"


def run_turn(req: ChatRequest) -> Iterator[dict[str, Any]]:
    # Mask card numbers and secrets before the message is stored, shown to specialists or sent to a model.
    redaction = privacy.redact(req.message) if settings.pii_redaction_enabled else None
    if redaction and redaction.changed:
        req = req.model_copy(update={"message": redaction.text})
    conv = _ensure_conversation(req)
    conv_id = conv["id"]
    graph = get_graph()
    config = _graph_config(conv_id)
    yield {"type": "conversation", "conversation": conv}

    customer_msg = db.add_message(conv_id, "customer", req.message, {"redacted": redaction.kinds} if redaction and redaction.changed else None)
    yield {"type": "customer_message", "message": customer_msg}
    if redaction and redaction.changed:
        notice = db.add_message(conv_id, "system", privacy.redaction_notice(redaction.kinds), {"redaction_notice": True})
        yield {"type": "message", "message": notice, "conversation": db.get_conversation(conv_id)}

    # A specialist owns the conversation: record the message for them instead of answering.
    ticket = db.open_ticket_for_conversation(conv_id)
    if conv["status"] == "escalated" and ticket:
        graph.update_state(config, {"messages": [HumanMessage(req.message)]}, as_node="memory_manager")
        db.update_ticket(ticket["id"], status=ticket["status"])
        note = db.add_message(
            conv_id, "system",
            f"Your message was added to ticket {ticket['id']}. A specialist will reply here shortly.",
            {"ticket_id": ticket["id"], "handoff": True},
        )
        CHAT_TURNS.inc(outcome="queued_for_specialist")
        yield {"type": "message", "message": note, "conversation": db.get_conversation(conv_id)}
        return
    if conv["status"] != "ai":
        db.update_conversation(conv_id, status="ai")

    started = time.perf_counter()
    turn_input = {
        **TURN_RESET,
        "messages": [HumanMessage(req.message)],
        "conversation_id": conv_id,
        "customer_id": req.customer_id,
    }
    steps: list[dict[str, Any]] = []
    usage = Usage()
    try:
        stream = graph.stream(turn_input, config, stream_mode="updates")
        while True:
            # Nodes run one after another, so the time to the next update is that node's own time; the clock
            # starts here so it excludes however long the client took to consume the previous step.
            node_started = time.perf_counter()
            # Usage is bound per step, never across the yield below (see llm.track_usage).
            with track_usage(usage):
                chunk = next(stream, None)
            if chunk is None:
                break
            elapsed = time.perf_counter() - node_started
            for node, update in chunk.items():
                AGENT_NODE_LATENCY.observe(elapsed, node=node)
                step = {**_step_payload(node, update or {}), "duration_ms": round(elapsed * 1000, 1)}
                steps.append(step)
                yield {"type": "step", "step": step}
    except Exception:  # noqa: BLE001
        log.exception("Graph run failed for %s", conv_id)
        CHAT_TURNS.inc(outcome="error")
        err = db.add_message(conv_id, "system", "Sorry — something went wrong on our side. Please try again, or ask for a human.", {"error": True})
        yield {"type": "message", "message": err, "conversation": db.get_conversation(conv_id)}
        return

    state = graph.get_state(config).values
    latency_ms = round((time.perf_counter() - started) * 1000)
    CHAT_TURNS.inc(outcome=_outcome(state))
    ticket = state.get("ticket")
    meta = {
        "intent": state.get("intent"),
        "intent_label": INTENTS.get(state.get("intent", ""), {}).get("label"),
        "intent_confidence": state.get("intent_confidence"),
        "sentiment": state.get("sentiment"),
        "confidence": state.get("confidence"),
        "confidence_breakdown": state.get("confidence_breakdown"),
        "action": state.get("action"),
        "escalated": bool(state.get("escalate")),
        "escalation_reason": state.get("escalation_reason"),
        "ticket_id": ticket.get("id") if ticket else None,
        "sources": [
            {k: d[k] for k in ("id", "title", "section", "score")}
            for d in state.get("retrieved_docs", [])
            if not state.get("cited_sources") or d["id"] in state["cited_sources"]
        ],
        "mode": state.get("mode"),
        "latency_ms": latency_ms,
        "route": [s["node"] for s in steps],
        "language": state.get("language") or "en",
        "action_proposal": state.get("action_proposal"),
        "action_result": state.get("action_result"),
        "knowledge_gap": bool(state.get("knowledge_gap")),
        "retrieval_confidence": state.get("retrieval_confidence"),
        "query": state.get("standalone_query"),
        "usage": usage.to_dict() if usage.llm_calls else None,
    }
    reply = db.add_message(conv_id, "assistant", state.get("final_response") or "", meta)
    db.update_conversation(conv_id, last_intent=state.get("intent"), last_confidence=state.get("confidence"), language=meta["language"])
    yield {"type": "message", "message": reply, "conversation": db.get_conversation(conv_id)}


# ------------------------------------------------------------------ public endpoints
@app.get("/api/health")
def health() -> dict[str, Any]:
    r = get_retriever()
    return {"status": "ok", "provider": resolve_provider(), "model": model_name(), "kb_documents": len(r.documents), "kb_chunks": len(r.chunks),
            "llm_circuit": breaker.state}


@app.get("/api/health/live")
def liveness() -> dict[str, Any]:
    """Liveness probe: the process is up and serving. Restart the container if this fails."""
    return {"status": "ok", "uptime_seconds": observability.uptime_seconds()}


@app.get("/api/health/ready")
def readiness(response: Response) -> dict[str, Any]:
    """Readiness probe: every dependency needed to answer customers works. Route traffic here only while it's 200.

    The LLM is informational, not a readiness condition: with the provider down Relay still answers (offline engine).
    """
    checks: dict[str, dict[str, Any]] = {}

    def probe(name: str, fn: Callable[[], dict[str, Any] | None]) -> None:
        started = time.perf_counter()
        try:
            detail = fn() or {}
            checks[name] = {"ok": True, "latency_ms": round((time.perf_counter() - started) * 1000, 1), **detail}
        except Exception as exc:  # noqa: BLE001
            checks[name] = {"ok": False, "error": f"{type(exc).__name__}: {exc}"[:200]}

    def knowledge_base() -> dict[str, Any]:
        chunks = len(get_retriever().chunks)
        if not chunks:
            raise RuntimeError("knowledge base is empty")
        return {"chunks": chunks}

    probe("database", lambda: db.query_pairs("SELECT 1") and None)
    probe("agent_memory", lambda: get_graph().checkpointer.get_tuple(_graph_config("__readiness_probe__")) and None)
    probe("knowledge_base", knowledge_base)
    ready = all(c["ok"] for c in checks.values())
    if not ready:
        response.status_code = 503
    return {
        "status": "ready" if ready else "not_ready",
        "version": app.version,
        "checks": checks,
        "llm": {"provider": resolve_provider(), "model": model_name(), "circuit": breaker.state},
        "webhook_outbox": webhooks.outbox_counts(),
    }


@app.get("/metrics", include_in_schema=False)
def metrics(authorization: str | None = Header(default=None)) -> Response:
    """Prometheus metrics. Protected by RELAY_METRICS_TOKEN when set (compare in constant time)."""
    token = settings.metrics_token
    if token and not hmac.compare_digest((authorization or "").encode(), f"Bearer {token}".encode()):
        raise HTTPException(401, "Invalid or missing metrics token", headers={"WWW-Authenticate": "Bearer"})
    return Response(observability.render_metrics(), media_type="text/plain; version=0.0.4; charset=utf-8")


@app.get("/api/config")
def public_config() -> dict[str, Any]:
    return {
        "assistant_name": settings.assistant_name,
        "company_name": settings.company_name,
        "accent_color": settings.accent_color,
        "welcome_message": settings.welcome_message,
        "suggested_prompts": settings.suggested_prompts,
        "provider": resolve_provider(),
        "model": model_name(),
        "confidence_threshold": settings.confidence_threshold,
        "refund_approval_limit": settings.refund_approval_limit,
        "auto_actions_enabled": settings.auto_actions_enabled,
        "multilingual_enabled": settings.multilingual_enabled,
        "admin_key_required": bool(settings.admin_api_key),
    }


@app.get("/api/demo/customers")
def demo_customers() -> list[dict[str, Any]]:
    """Demo identities for the widget's 'sign in as' switcher. Remove in production (use your SSO)."""
    return [
        {"id": c["id"], "name": c["name"], "email": c["email"], "tier": c["tier"],
         "orders": [{"id": o["id"], "status": o["status"], "total": o["total"]} for o in commerce.orders_for_customer(c["id"])]}
        for c in commerce.list_customers()
    ]


@app.post("/api/chat", dependencies=[Depends(rate_limit)])
def chat(
    req: ChatRequest, response: Response, idempotency_key: str | None = Header(default=None, alias=idempotency.HEADER)
) -> dict[str, Any]:
    """Send a message and get the whole turn back. With an Idempotency-Key header, retries never double-send."""

    def work() -> dict[str, Any]:
        result: dict[str, Any] = {"steps": []}
        for event in run_turn(req):
            if event["type"] == "step":
                result["steps"].append(event["step"])
            elif event["type"] in ("conversation", "message"):
                result.update({k: v for k, v in event.items() if k != "type"})
        return result

    if not idempotency_key:
        return work()
    result, replayed = idempotency.run(req.customer_id or "guest", idempotency_key, req.model_dump(), work)
    if replayed:
        response.headers["Idempotent-Replayed"] = "true"
    return result


@app.post("/api/chat/stream", dependencies=[Depends(rate_limit)])
def chat_stream(req: ChatRequest) -> StreamingResponse:
    _ensure_conversation(req) if req.conversation_id else None  # surface 403/404 before streaming starts

    def sse() -> Iterator[str]:
        for event in run_turn(req):
            yield f"event: {event['type']}\ndata: {json.dumps(event, default=str)}\n\n"
        yield "event: done\ndata: {}\n\n"

    return StreamingResponse(sse(), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@app.get("/api/conversations/{conversation_id}")
def get_conversation(conversation_id: str) -> dict[str, Any]:
    conv = db.get_conversation(conversation_id)
    if not conv:
        raise HTTPException(404, "Conversation not found")
    return {"conversation": conv, "messages": db.list_messages(conversation_id), "ticket": db.open_ticket_for_conversation(conversation_id)}


@app.get("/api/conversations/{conversation_id}/messages")
def poll_messages(conversation_id: str, after_id: int = 0) -> dict[str, Any]:
    conv = db.get_conversation(conversation_id)
    if not conv:
        raise HTTPException(404, "Conversation not found")
    return {"conversation": conv, "messages": db.list_messages(conversation_id, after_id)}


@app.post("/api/conversations/{conversation_id}/feedback")
def feedback(conversation_id: str, body: FeedbackRequest) -> dict[str, Any]:
    if not db.get_conversation(conversation_id):
        raise HTTPException(404, "Conversation not found")
    db.update_conversation(conversation_id, csat=body.rating, csat_comment=body.comment)
    if body.rating <= 2:
        webhooks.emit("feedback.negative", {"conversation_id": conversation_id, "rating": body.rating, "comment": body.comment})
    return {"ok": True}


# ------------------------------------------------------------------ console (admin)
agent = [Depends(require_agent)]  # any signed-in console user


@app.get("/api/admin/conversations", dependencies=agent)
def list_conversations(status: str | None = None) -> list[dict[str, Any]]:
    return db.list_conversations(status)


@app.get("/api/admin/conversations/{conversation_id}", dependencies=agent)
def conversation_detail(conversation_id: str) -> dict[str, Any]:
    conv = db.get_conversation(conversation_id)
    if not conv:
        raise HTTPException(404, "Conversation not found")
    values = get_graph().get_state(_graph_config(conversation_id)).values
    return {
        "conversation": conv,
        "messages": db.list_messages(conversation_id),
        "customer": {**commerce.customer_summary(c), "health": customer_health(c["id"])}
        if (c := commerce.get_customer(conv["customer_id"])) else None,
        "memory": {
            "entities": values.get("entities", {}),
            "summary": values.get("memory_summary", ""),
            "messages_in_window": len(values.get("messages", [])),
            "low_confidence_streak": values.get("low_confidence_streak", 0),
        },
        "actions": actions.list_actions(conversation_id=conversation_id),
    }


@app.get("/api/admin/tickets", dependencies=agent)
def list_tickets(status: str | None = None) -> list[dict[str, Any]]:
    tickets = db.list_tickets(status)
    pending = dict(db.query_pairs("SELECT ticket_id, COUNT(*) FROM actions WHERE status = 'pending_approval' GROUP BY ticket_id"))
    languages = dict(db.query_pairs("SELECT id, language FROM conversations"))
    for t in tickets:
        customer = commerce.get_customer(t["customer_id"])
        t["customer_name"] = customer["name"] if customer else "Guest"
        t["customer_tier"] = customer["tier"] if customer else None
        t["pending_actions"] = pending.get(t["id"], 0)
        t["language"] = languages.get(t["conversation_id"]) or "en"
    return tickets


@app.get("/api/admin/tickets/{ticket_id}", dependencies=agent)
def ticket_detail(ticket_id: str) -> dict[str, Any]:
    ticket = db.get_ticket(ticket_id)
    if not ticket:
        raise HTTPException(404, "Ticket not found")
    detail = conversation_detail(ticket["conversation_id"])
    return {"ticket": ticket, **detail}


@app.post("/api/admin/tickets/{ticket_id}/reply")
def reply_ticket(ticket_id: str, body: TicketReply, principal: Principal = Depends(require_agent)) -> dict[str, Any]:
    ticket = db.get_ticket(ticket_id)
    if not ticket:
        raise HTTPException(404, "Ticket not found")
    conv_id = ticket["conversation_id"]
    name = actor_name(principal, body.agent_name)
    # Also lands in agent memory so the AI has full context if it takes over again.
    message = post_specialist_message(conv_id, body.content, name, {"ticket_id": ticket_id})
    if body.resolve:
        _resolve(ticket_id, conv_id, name)
    else:
        db.update_ticket(ticket_id, status="in_progress", assignee=ticket["assignee"] or name)
    audit.record("ticket.reply", "ticket", ticket_id, {"agent_name": name, "resolved": body.resolve, "characters": len(body.content)})
    return {"message": message, "ticket": db.get_ticket(ticket_id)}


_resolve = resolve_ticket


@app.patch("/api/admin/tickets/{ticket_id}")
def patch_ticket(ticket_id: str, body: TicketPatch, principal: Principal = Depends(require_agent)) -> dict[str, Any]:
    ticket = db.get_ticket(ticket_id)
    if not ticket:
        raise HTTPException(404, "Ticket not found")
    if body.assignee is not None:
        body.assignee = actor_name(principal, body.assignee)
    fields = body.model_dump(exclude_none=True)
    changes = {k: {"from": ticket.get(k), "to": v} for k, v in fields.items() if ticket.get(k) != v}
    if changes:
        audit.record("ticket.update", "ticket", ticket_id, {"changes": changes})
    if fields.get("status") == "resolved" and ticket["status"] != "resolved":
        fields.pop("status")
        _resolve(ticket_id, ticket["conversation_id"], body.assignee or ticket["assignee"])
    elif fields.get("status") in ("open", "in_progress") and ticket["status"] == "resolved":
        db.update_conversation(ticket["conversation_id"], status="escalated")
        fields["resolved_at"] = None
    if fields:
        db.update_ticket(ticket_id, **fields)
    return db.get_ticket(ticket_id)  # type: ignore[return-value]


@app.get("/api/admin/events")
async def live_events(request: Request, principal: Principal = Depends(require_agent)) -> StreamingResponse:
    """Server-sent events telling the console which data changed, so it refetches instantly instead of polling.

    EventSource sends the session cookie (withCredentials) but can't set headers, which is why this is
    cookie- or open-mode only; API-key clients keep polling.
    """
    token = request.cookies.get(settings.session_cookie_name)

    async def stream() -> AsyncIterator[str]:
        yield "retry: 3000\n\n"  # browser reconnect delay after a drop
        yield "event: ready\ndata: {}\n\n"
        async for topics in events.subscribe():
            if await request.is_disconnected():
                break
            if topics is None:
                # Quiet period: heartbeat, and end the stream if the session was revoked or expired meanwhile.
                if principal.kind == "user" and not (token and await run_in_threadpool(auth.session_user, token)):
                    yield "event: signed_out\ndata: {}\n\n"
                    break
                yield ": keepalive\n\n"
                continue
            yield f"event: change\ndata: {json.dumps({'topics': sorted(topics)})}\n\n"

    return StreamingResponse(stream(), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@app.get("/api/admin/analytics", dependencies=agent)
def analytics() -> dict[str, Any]:
    base = db.analytics()
    return {**base, **reporting.business_metrics(base), "knowledge_gaps": len(insights.knowledge_gaps(limit=100))}


# ------------------------------------------------------------------ knowledge base (admin)
def _doc_path(doc_id: str):
    if not SAFE_DOC_ID.match(doc_id):
        raise HTTPException(400, "Invalid document id")
    return settings.knowledge_base_dir / f"{doc_id}.md"


@app.get("/api/admin/kb/documents", dependencies=agent)
def kb_documents() -> list[dict[str, Any]]:
    r = get_retriever()
    counts: dict[str, int] = defaultdict(int)
    for c in r.chunks:
        counts[c.doc_id] += 1
    return [
        {"id": d.id, "title": d.title, "category": d.category, "chunks": counts[d.id],
         "characters": len(d.body), "updated_at": time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime(d.path.stat().st_mtime))}
        for d in r.documents
    ]


@app.get("/api/admin/kb/documents/{doc_id}", dependencies=agent)
def kb_document(doc_id: str) -> dict[str, Any]:
    doc = next((d for d in get_retriever().documents if d.id == doc_id), None)
    if not doc:
        raise HTTPException(404, "Document not found")
    return {"id": doc.id, "title": doc.title, "category": doc.category, "body": doc.body}


@app.put("/api/admin/kb/documents/{doc_id}", dependencies=agent)
def kb_upsert(doc_id: str, body: KBDocument) -> dict[str, Any]:
    path = _doc_path(doc_id)
    existed = path.exists()
    path.write_text(render_markdown(body.title, body.category, body.body), encoding="utf-8")
    get_retriever().reload()
    events.publish("kb")  # articles live on disk, not in SQLite, so announce the change ourselves
    audit.record("kb.update" if existed else "kb.create", "kb_document", doc_id,
                 {"title": body.title, "category": body.category, "characters": len(body.body)})
    return kb_document(doc_id)


@app.post("/api/admin/kb/documents", dependencies=agent)
def kb_create(body: KBDocument) -> dict[str, Any]:
    doc_id = re.sub(r"[^a-z0-9]+", "_", body.title.lower()).strip("_")[:60] or "document"
    if _doc_path(doc_id).exists():
        raise HTTPException(409, "A document with this title already exists")
    return kb_upsert(doc_id, body)


@app.delete("/api/admin/kb/documents/{doc_id}", dependencies=[Depends(require_admin)])
def kb_delete(doc_id: str) -> dict[str, Any]:
    path = _doc_path(doc_id)
    if not path.exists():
        raise HTTPException(404, "Document not found")
    path.unlink()
    get_retriever().reload()
    events.publish("kb")
    audit.record("kb.delete", "kb_document", doc_id)
    return {"ok": True}


@app.post("/api/admin/kb/search", dependencies=agent)
def kb_search(body: SearchRequest) -> list[dict[str, Any]]:
    return [h.to_dict() for h in get_retriever().search(body.query, top_k=body.top_k)]

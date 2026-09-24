"""Observability, LLM circuit breaker and usage, PII redaction, privacy requests, audit log, webhook outbox,
SSRF protection, idempotency and rate-limit headers."""

from datetime import datetime, timedelta, timezone

import pytest
from langchain_core.messages import AIMessage
from pydantic import BaseModel

from app import audit, db, llm, main, privacy, webhooks
from app.agents.graph import get_graph
from app.config import get_settings
from app.support_ops import graph_config


@pytest.fixture
def settings(monkeypatch):
    s = get_settings()

    def set_(**values):
        for key, value in values.items():
            monkeypatch.setattr(s, key, value)

    return set_


# ------------------------------------------------------------------ observability
def test_request_ids_and_security_headers(client):
    res = client.get("/api/health")
    assert res.headers["x-request-id"].startswith("req_")
    assert res.headers["x-content-type-options"] == "nosniff" and res.headers["x-frame-options"] == "DENY"
    assert client.get("/api/health", headers={"X-Request-ID": "trace-abc-12345"}).headers["x-request-id"] == "trace-abc-12345"
    assert client.get("/api/health", headers={"X-Request-ID": "bad id\nwith newline"}).headers["x-request-id"].startswith("req_")
    assert client.get("/api/admin/tickets").headers["cache-control"] == "no-store"


def test_health_probes(client, monkeypatch):
    assert client.get("/api/health/live").json()["status"] == "ok"
    ready = client.get("/api/health/ready")
    assert ready.status_code == 200 and ready.json()["status"] == "ready"
    assert {"database", "agent_memory", "knowledge_base"} <= ready.json()["checks"].keys()

    monkeypatch.setattr(main.get_retriever(), "chunks", [])
    broken = client.get("/api/health/ready")
    assert broken.status_code == 503 and not broken.json()["checks"]["knowledge_base"]["ok"]


def test_metrics_and_node_timings(chat, client, settings):
    body = chat("CUST-005").send("Do you ship to Canada?")
    assert all(isinstance(s["duration_ms"], float) for s in body["steps"])
    text = client.get("/metrics").text
    assert 'relay_http_requests_total{method="POST",route="/api/chat",status="200"}' in text
    assert 'relay_agent_node_duration_seconds_bucket{node="intent_classifier",le="+Inf"}' in text
    assert "relay_chat_turns_total" in text and "relay_info{" in text

    settings(metrics_token="scrape-me")
    assert client.get("/metrics").status_code == 401
    assert client.get("/metrics", headers={"Authorization": "Bearer scrape-me"}).status_code == 200


# ------------------------------------------------------------------ LLM circuit breaker & usage
class Answer(BaseModel):
    text: str


class FakeModel:
    def __init__(self, fail: bool):
        self.fail, self.calls = fail, 0

    def with_structured_output(self, schema, include_raw=False):
        assert include_raw
        return self

    def invoke(self, messages):
        self.calls += 1
        if self.fail:
            raise TimeoutError("provider timed out")
        raw = AIMessage(content="", usage_metadata={"input_tokens": 1000, "output_tokens": 500, "total_tokens": 1500})
        return {"raw": raw, "parsed": Answer(text="hi"), "parsing_error": None}


@pytest.fixture
def breaker():
    llm.breaker.reset()
    yield llm.breaker
    llm.breaker.reset()


def test_circuit_breaker_opens_then_recovers(monkeypatch, settings, breaker):
    settings(llm_circuit_failure_threshold=2, llm_circuit_cooldown_seconds=3600)
    model = FakeModel(fail=True)
    monkeypatch.setattr(llm, "get_chat_model", lambda: model)

    assert llm.structured_call(Answer, []) is None and llm.structured_call(Answer, []) is None
    assert breaker.state == "open"
    assert llm.structured_call(Answer, []) is None
    assert model.calls == 2  # the third call never reached the provider

    settings(llm_circuit_cooldown_seconds=0)  # cooldown over: one trial call is let through
    model.fail = False
    assert llm.structured_call(Answer, []).text == "hi"
    assert breaker.state == "closed"


def test_failed_trial_reopens_the_circuit(monkeypatch, settings, breaker):
    settings(llm_circuit_failure_threshold=1, llm_circuit_cooldown_seconds=0)
    model = FakeModel(fail=True)
    monkeypatch.setattr(llm, "get_chat_model", lambda: model)
    llm.structured_call(Answer, [])
    assert breaker.state == "half_open"
    settings(llm_circuit_cooldown_seconds=3600)
    llm.structured_call(Answer, [])  # the trial fails
    assert breaker.state == "open"


def test_token_usage_and_cost(monkeypatch, settings, breaker):
    monkeypatch.setattr(llm, "get_chat_model", lambda: FakeModel(fail=False))
    with llm.track_usage() as usage:
        llm.structured_call(Answer, [])
        llm.structured_call(Answer, [])
    assert (usage.llm_calls, usage.input_tokens, usage.output_tokens) == (2, 2000, 1000)
    assert usage.cost_usd is None  # no prices configured: unknown, not $0
    settings(llm_input_cost_per_mtok=3.0, llm_output_cost_per_mtok=15.0)
    assert usage.cost_usd == pytest.approx(0.006 + 0.015)


def test_analytics_report_llm_usage(client):
    usage = client.get("/api/admin/analytics").json()["llm_usage"]
    assert {"llm_calls", "input_tokens", "output_tokens", "cost_usd", "cost_per_conversation"} <= usage.keys()


# ------------------------------------------------------------------ PII redaction
@pytest.mark.parametrize("text, expected, kinds", [
    ("my card is 4242 4242 4242 4242 thanks", "my card is [card ending 4242] thanks", ["card_number"]),
    ("card 4111-1111-1111-1111 exp 12/29", "card [card ending 1111] exp 12/29", ["card_number"]),
    ("the CVV is 123", "the CVV is [redacted]", ["cvv"]),
    ("SSN 123-45-6789", "SSN [SSN redacted]", ["ssn"]),
    ("my verification code is 482913", "my verification code is [redacted]", ["one_time_code"]),
    ("password: Hunter22!", "password: [redacted]", ["password"]),
])
def test_sensitive_values_are_masked(text, expected, kinds):
    result = privacy.redact(text)
    assert result.text == expected and result.kinds == kinds


@pytest.mark.parametrize("text", [
    "Where is ORD-10342?",
    "order 1234 5678 9012 3456 isn't a real card",  # fails the Luhn check
    "my password is not working",
    "call me at +1 415 555 0100",
    "tracking number 9400111899223344556677",
])
def test_ordinary_text_is_left_alone(text):
    assert privacy.redact(text).text == text


def test_card_numbers_never_reach_storage_or_agent_memory(chat, client):
    convo = chat("CUST-004")
    convo.send("I paid with 4242 4242 4242 4242, where is my order?")
    messages = client.get(f"/api/conversations/{convo.id}").json()["messages"]
    customer = next(m for m in messages if m["role"] == "customer")
    assert "4242 4242" not in customer["content"] and "[card ending 4242]" in customer["content"]
    assert customer["meta"]["redacted"] == ["card_number"]
    assert any(m["meta"].get("redaction_notice") for m in messages)
    memory = get_graph().get_state(graph_config(convo.id)).values["messages"]
    assert all("4242 4242" not in str(m.content) for m in memory)


# ------------------------------------------------------------------ privacy requests & retention
def test_customer_export_and_erasure(chat, client):
    convo = chat("CUST-001")
    convo.send("Hi, my email is maya.chen@example.com — where's my order?")

    export = client.get("/api/admin/customers/CUST-001/export")
    assert export.status_code == 200 and "attachment" in export.headers["content-disposition"]
    assert any(c["id"] == convo.id for c in export.json()["conversations"])

    assert client.post("/api/admin/customers/CUST-001/erase", json={"confirm": "CUST-002"}).status_code == 422
    erased = client.post("/api/admin/customers/CUST-001/erase", json={"confirm": "CUST-001"}).json()["erased"]
    assert erased["conversations"] >= 1 and erased["messages"] >= 2

    conv = db.get_conversation(convo.id)
    assert conv["customer_id"] is None and conv["erased_at"] and conv["title"] == privacy.ERASED
    messages = db.list_messages(convo.id)
    assert all(m["content"] == privacy.ERASED for m in messages)
    assert all(set(m["meta"]) <= privacy.SAFE_META for m in messages)  # e.g. the rewritten query is gone
    assert not get_graph().get_state(graph_config(convo.id)).values  # agent memory deleted
    assert audit.list_entries(action="customer.erase", target_id="CUST-001")


def test_retention_keeps_open_escalations(chat, settings):
    old = (datetime.now(timezone.utc) - timedelta(days=400)).isoformat(timespec="seconds")
    closed = chat("CUST-002")
    closed.send("What's your return policy?")
    escalated = chat("CUST-002")
    escalated.send("talk to a human")
    for cid in (closed.id, escalated.id):
        db.execute("UPDATE conversations SET updated_at = ? WHERE id = ?", (old, cid))

    settings(retention_days=0)
    assert privacy.apply_retention() == 0
    settings(retention_days=365)
    assert privacy.apply_retention() >= 1
    assert db.get_conversation(closed.id)["erased_at"]
    assert not db.get_conversation(escalated.id)["erased_at"]  # a specialist still owns it


# ------------------------------------------------------------------ audit log
def test_privileged_changes_are_audited_and_chained(client):
    original = client.get("/api/admin/settings").json()["settings"]["refund_approval_limit"]
    res = client.patch("/api/admin/settings", json={"refund_approval_limit": original + 50})
    try:
        entry = client.get("/api/admin/audit", params={"action": "settings.*"}).json()["entries"][0]
        assert entry["action"] == "settings.update" and entry["actor"] == "open"
        assert entry["details"]["changes"]["refund_approval_limit"] == {"from": original, "to": original + 50}
        assert entry["request_id"] == res.headers["x-request-id"]
        assert client.get("/api/admin/audit/verify").json()["ok"]
    finally:
        client.patch("/api/admin/settings", json={"refund_approval_limit": original})


def test_audit_tampering_is_detected(client):
    audit.record("test.event", "thing", "t1", {"n": 1})
    entry = audit.list_entries(action="test.event")[0]
    db.execute("UPDATE audit_log SET details = ? WHERE id = ?", ('{"n": 2}', entry["id"]))
    try:
        result = client.get("/api/admin/audit/verify").json()
        assert not result["ok"] and result["broken_at"] == entry["id"] and "modified" in result["reason"]
    finally:
        db.execute("UPDATE audit_log SET details = ? WHERE id = ?", ('{"n": 1}', entry["id"]))
    assert audit.verify()["ok"]


# ------------------------------------------------------------------ webhook outbox
@pytest.fixture
def receiver(monkeypatch):
    """A fake endpoint whose responses are scripted; records every request."""
    state = {"responses": [], "requests": []}

    def fake_send(url, body, headers):
        state["requests"].append({"url": url, "body": body, "headers": headers})
        outcome = state["responses"].pop(0) if state["responses"] else 200
        if isinstance(outcome, Exception):
            raise outcome
        return outcome

    monkeypatch.setattr(webhooks, "_send", fake_send)
    db.execute("DELETE FROM webhook_outbox")  # earlier test modules leave delivered rows behind
    yield state
    db.execute("DELETE FROM webhooks")
    db.execute("DELETE FROM webhook_outbox")


def _hook(client):
    return client.post("/api/admin/webhooks", json={"name": "Ops", "url": "https://hooks.example.com/r", "events": ["ticket.created"]}).json()


def _later(hours=48):
    return datetime.now(timezone.utc) + timedelta(hours=hours)


def test_failed_delivery_is_retried_with_the_same_event_id(client, receiver):
    _hook(client)
    receiver["responses"] = [503, 200]
    webhooks.emit("ticket.created", {"ticket": {"id": "TCK-RETRY1"}})
    row = webhooks.outbox()[0]
    assert row["status"] == "pending" and row["attempts"] == 1 and row["last_status_code"] == 503
    assert datetime.fromisoformat(row["next_attempt_at"]) > datetime.now(timezone.utc)

    assert webhooks.drain_outbox() == 0  # not due yet
    assert webhooks.drain_outbox(now=_later()) == 1
    row = webhooks.outbox()[0]
    assert row["status"] == "delivered" and row["attempts"] == 2
    first, second = receiver["requests"]
    assert first["body"] == second["body"]  # same envelope id: receivers can dedupe
    assert (first["headers"]["X-Relay-Attempt"], second["headers"]["X-Relay-Attempt"]) == ("1", "2")
    assert second["headers"]["X-Relay-Delivery"] == row["id"]


def test_dead_letter_and_replay(client, receiver, settings):
    settings(webhook_max_attempts=2)
    _hook(client)
    receiver["responses"] = [ConnectionError("refused"), ConnectionError("refused")]
    webhooks.emit("ticket.created", {"ticket": {"id": "TCK-DEAD01"}})
    webhooks.drain_outbox(now=_later())
    row = webhooks.outbox()[0]
    assert row["status"] == "dead" and row["attempts"] == 2 and "refused" in row["last_error"]
    assert client.get("/api/admin/webhooks/outbox", params={"status": "dead"}).json()["counts"]["dead"] == 1

    replayed = client.post(f"/api/admin/webhooks/outbox/{row['id']}/retry").json()
    assert replayed["status"] == "delivered"
    assert client.post(f"/api/admin/webhooks/outbox/{row['id']}/retry").status_code == 409
    assert audit.list_entries(action="webhook.replay", target_id=row["id"])


def test_deliveries_to_a_deleted_webhook_are_dead_lettered(client, receiver):
    hook = _hook(client)
    receiver["responses"] = [500]
    webhooks.emit("ticket.created", {"ticket": {"id": "TCK-GONE01"}})
    client.delete(f"/api/admin/webhooks/{hook['id']}")
    webhooks.drain_outbox(now=_later())
    assert webhooks.outbox()[0]["status"] == "dead" and len(receiver["requests"]) == 1


# ------------------------------------------------------------------ SSRF
@pytest.mark.parametrize("url", ["http://127.0.0.1:8000/hook", "http://169.254.169.254/latest/meta-data", "http://localhost/x",
                                 "http://10.0.0.5/hook", "http://[::1]/hook", "http://metadata.google.internal/x"])
def test_private_webhook_destinations_are_refused(client, url):
    res = client.post("/api/admin/webhooks", json={"name": "x", "url": url, "events": ["ticket.created"]})
    assert res.status_code == 422 and "refused" in res.json()["detail"]


def test_dns_resolving_to_private_address_is_refused_at_delivery(monkeypatch, settings):
    monkeypatch.setattr(webhooks.socket, "getaddrinfo", lambda *a, **k: [(2, 1, 6, "", ("10.1.2.3", 0))])
    with pytest.raises(webhooks.UnsafeDestination, match="10.1.2.3"):
        webhooks.check_destination("https://rebinding.example/hook")
    settings(webhook_allow_private_networks=True)
    webhooks.check_destination("https://rebinding.example/hook")


# ------------------------------------------------------------------ idempotency & rate limits
def test_idempotent_chat_retries_do_not_duplicate(client):
    payload = {"message": "Do you ship to Canada?", "customer_id": "CUST-005"}
    headers = {"Idempotency-Key": "retry-test-0001"}
    first = client.post("/api/chat", json=payload, headers=headers)
    second = client.post("/api/chat", json=payload, headers=headers)
    assert first.json()["message"]["id"] == second.json()["message"]["id"]
    assert second.headers["idempotent-replayed"] == "true" and "idempotent-replayed" not in first.headers
    assert len(db.list_messages(first.json()["conversation"]["id"])) == 2  # one customer message, one reply

    other = client.post("/api/chat", json={**payload, "message": "Something else"}, headers=headers)
    assert other.status_code == 422
    assert client.post("/api/chat", json=payload, headers={"Idempotency-Key": "short"}).status_code == 400


def test_rate_limit_headers_and_retry_after(client, settings):
    main._rate.clear()
    settings(chat_rate_limit_per_minute=2)
    try:
        ok = client.post("/api/chat", json={"message": "hi"})
        assert ok.headers["ratelimit-limit"] == "2" and ok.headers["ratelimit-remaining"] == "1"
        client.post("/api/chat", json={"message": "hi"})
        limited = client.post("/api/chat", json={"message": "hi"})
        assert limited.status_code == 429 and int(limited.headers["retry-after"]) >= 1
        assert limited.headers["ratelimit-remaining"] == "0"
    finally:
        main._rate.clear()

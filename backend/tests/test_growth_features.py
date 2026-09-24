"""Test Lab (agent regression tests), Pulse (emerging issues) and customer health."""

from datetime import datetime, timedelta, timezone

import pytest

from app import commerce, db, evals, health, pulse, webhooks


@pytest.fixture(autouse=True)
def clean_state(client):
    yield
    commerce.reset_order_state()
    db.execute("DELETE FROM actions")
    db.execute("DELETE FROM webhooks")
    db.execute("DELETE FROM pulse_alerts")
    db.execute("DELETE FROM eval_scenarios WHERE source != 'builtin'")


@pytest.fixture
def captured(monkeypatch):
    sent: list[dict] = []
    monkeypatch.setattr(webhooks, "_send", lambda url, body, headers: sent.append({"url": url, "body": body}) or 200)
    return sent


def run(client, **body):
    res = client.post("/api/admin/evals/runs", json={"wait": True, **body})
    assert res.status_code == 200, res.text
    return res.json()


# ------------------------------------------------------------------ test lab
def test_builtin_scenarios_all_pass(client):
    overview = client.get("/api/admin/evals").json()
    builtin = [s for s in overview["scenarios"] if s["source"] == "builtin"]
    assert len(builtin) == len(evals.BUILTIN_SCENARIOS)
    assert {"intents", "escalation_reasons", "action_types", "customers"} <= overview["catalog"].keys()

    result = run(client)
    failures = [(r["name"], [c for c in r["checks"] if not c["passed"]], r["error"]) for r in result["results"] if not r["passed"]]
    assert result["status"] == "completed" and not failures, failures
    assert result["passed"] == result["total"] >= len(builtin)


def test_run_leaves_no_trace(client, captured):
    client.post("/api/admin/webhooks", json={"name": "Ops", "url": "https://hooks.example.com/x",
                                             "events": ["ticket.created", "action.completed", "action.approval_requested"]})
    counts = {t: db.query(f"SELECT COUNT(*) AS n FROM {t}")[0]["n"] for t in ("conversations", "messages", "tickets", "actions")}
    run(client)  # cancels an order, starts a return, queues a refund approval, opens tickets...
    assert {t: db.query(f"SELECT COUNT(*) AS n FROM {t}")[0]["n"] for t in counts} == counts
    assert commerce.get_order("ORD-10460")["status"] == "processing"
    assert commerce.get_order("ORD-10388")["status"] == "delivered"
    assert captured == []  # sandbox runs never page anyone


def test_sandbox_is_isolated_from_real_orders(client, chat):
    convo = chat("CUST-004")
    convo.send("please cancel my order")
    convo.send("yes")  # a real cancellation, made before the test run
    refund = chat("CUST-003").send("I want a refund for ORD-10350")  # a real pending approval on another order
    scenarios = [s["id"] for s in evals.list_scenarios() if s["name"].startswith(("Cancel an order", "Refund over"))]

    result = run(client, scenario_ids=scenarios)
    assert all(r["passed"] for r in result["results"])  # tests see pristine orders, so real history can't break them
    assert commerce.get_order("ORD-10460")["status"] == "canceled"  # ...and the real order is untouched
    real_pending = client.get("/api/admin/actions?status=pending_approval").json()
    assert [a["id"] for a in real_pending] == [refund["message"]["meta"]["action_result"]["id"]]


def test_custom_scenario_reports_each_failed_check(client):
    scenario = client.post("/api/admin/evals/scenarios", json={
        "name": "Wrong on purpose", "customer_id": "CUST-005", "turns": ["Talk to a human"],
        "expect": {"escalated": False, "reply_contains": ["ticket"], "reply_excludes": ["connecting"]},
    }).json()
    result = run(client, scenario_ids=[scenario["id"]])["results"][0]
    by_check = {c["check"]: c for c in result["checks"]}
    assert not result["passed"]
    assert by_check["escalated"] == {"check": "escalated", "expected": False, "actual": True, "passed": False}
    assert by_check["reply_contains"]["passed"] and not by_check["reply_excludes"]["passed"]
    assert result["turns"][0]["route"][-2:] == ["escalation_agent", "memory_manager"]

    latest = next(s for s in client.get("/api/admin/evals").json()["scenarios"] if s["id"] == scenario["id"])
    assert latest["last_result"]["passed"] is False


def test_scenario_validation(client):
    ok = {"name": "x", "turns": ["hi"], "expect": {"intent": "greeting"}}
    assert client.post("/api/admin/evals/scenarios", json={**ok, "expect": {}}).status_code == 422
    assert client.post("/api/admin/evals/scenarios", json={**ok, "turns": ["  "]}).status_code == 422
    assert client.post("/api/admin/evals/scenarios", json={**ok, "customer_id": "CUST-999"}).status_code == 422
    assert client.post("/api/admin/evals/scenarios", json={**ok, "expect": {"made_up": 1}}).status_code == 422
    assert client.post("/api/admin/evals/runs", json={"scenario_ids": ["scn_nope"], "wait": True}).status_code == 404


def test_save_real_conversation_as_regression_test(client, chat):
    convo = chat("CUST-003")
    convo.send("I want a refund for ORD-10350")
    scenario = client.post(f"/api/admin/evals/scenarios/from-conversation/{convo.id}").json()
    assert scenario["source"] == "conversation" and scenario["turns"] == ["I want a refund for ORD-10350"]
    assert scenario["expect"]["escalation_reason"] == "refund_approval"
    assert scenario["expect"]["action_status"] == "pending_approval"
    db.execute("DELETE FROM actions")  # free the order so the replay can queue its own approval
    assert run(client, scenario_ids=[scenario["id"]])["results"][0]["passed"]


def test_only_one_run_at_a_time(client):
    assert evals._run_lock.acquire(blocking=False)
    try:
        assert client.post("/api/admin/evals/runs", json={"wait": True}).status_code == 409
    finally:
        evals._run_lock.release()


def test_sandbox_conversations_are_hidden_from_the_console(client):
    sandbox = db.create_conversation("CUST-001", "[Test] hidden", sandbox=True)
    try:
        assert sandbox["id"] not in {c["id"] for c in client.get("/api/admin/conversations").json()}
    finally:
        db.execute("DELETE FROM conversations WHERE id = ?", (sandbox["id"],))


# ------------------------------------------------------------------ pulse
def _backdate(conversation_id: str, days: float) -> None:
    ts = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat(timespec="seconds")
    db.execute("UPDATE messages SET created_at = ? WHERE conversation_id = ?", (ts, conversation_id))
    db.execute("UPDATE tickets SET created_at = ? WHERE conversation_id = ?", (ts, conversation_id))
    db.execute("UPDATE conversations SET created_at = ? WHERE id = ?", (ts, conversation_id))


def test_pulse_flags_a_surging_topic_and_alerts_once(client, chat, captured):
    client.post("/api/admin/webhooks", json={"name": "Slack", "url": "https://hooks.slack.com/services/T/B/X", "kind": "slack",
                                             "events": ["insight.spike"]})
    _backdate(chat("CUST-002").send("Do you ship to Canada?")["conversation"]["id"], 5)  # a baseline week exists
    for _ in range(4):
        chat("CUST-005").send("My new stove arrived damaged")

    report = client.get("/api/admin/insights/pulse").json()
    assert not report["warming_up"]
    damaged = next(i for i in report["issues"] if i["id"] == "intent:damaged_or_wrong_item")
    assert damaged["current"] >= 4 and damaged["series"][-1] == damaged["current"] and len(damaged["series"]) == 8
    assert damaged["examples"] and "damaged" in damaged["examples"][0]

    assert pulse.check_spikes() >= 1
    assert any("Emerging issue" in c["body"] and "Damaged" in c["body"] for c in captured)
    sent = len(captured)
    assert pulse.check_spikes() == 0 and len(captured) == sent  # one alert per issue per day


def test_pulse_ignores_steady_topics():
    now = datetime(2026, 9, 20, 12, tzinfo=timezone.utc)
    steady = pulse._issue("intent", "order_status", "Order status", [4, 5, 4, 5, 4, 5, 4, 5], [])
    assert steady is None  # 5 today vs ~4.4/day is normal
    assert pulse._issue("intent", "x", "X", [0, 0, 0, 0, 0, 0, 0, 2], []) is None  # too few to matter
    new = pulse._issue("intent", "x", "X", [0, 0, 0, 0, 0, 0, 0, 6], [])
    assert new["ratio"] is None and new["severity"] == "high"
    assert pulse._day_index((now - timedelta(hours=30)).isoformat(), now) == 1


# ------------------------------------------------------------------ customer health
def test_health_drops_with_bad_experiences_and_explains_why(client, chat):
    before = health.customer_health("CUST-002")["score"]
    convo = chat("CUST-002")
    convo.send("This is ridiculous, where is my refund?!")
    convo.send("There's an unauthorized charge on my card")
    db.update_conversation(convo.id, csat=1)

    after = health.customer_health("CUST-002")
    assert (after["score"] < before or after["score"] == 0) and after["risk"] in ("medium", "high")  # other tests share this customer
    labels = " ".join(f["label"] for f in after["factors"])
    assert "escalation" in labels and "low CSAT" in labels and "angry" in labels
    assert all(f["impact"] < 0 for f in after["factors"][:3])  # worst factors first

    detail = client.get(f"/api/admin/conversations/{convo.id}").json()
    assert detail["customer"]["health"]["score"] == after["score"]

    report = client.get("/api/admin/insights/customer-health").json()
    row = next(c for c in report["customers"] if c["customer_id"] == "CUST-002")
    assert row["name"] == "Jordan Alvarez" and row["latest_conversation_id"] == convo.id
    assert report["revenue_at_risk"] >= 486.2


def test_health_unknown_customer(client):
    assert client.get("/api/admin/customers/CUST-999/health").status_code == 404

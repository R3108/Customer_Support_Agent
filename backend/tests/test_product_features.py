"""Agentic actions, approvals, workspace settings, multilingual, knowledge insights, copilot, macros, webhooks and reporting."""

import pytest

from app import commerce, db, webhooks, workspace
from app.i18n import detect_language


def meta(body):
    return body["message"]["meta"]


@pytest.fixture(autouse=True)
def clean_state(client):
    original = workspace.current()
    yield
    commerce.reset_order_state()
    db.execute("DELETE FROM actions")
    db.execute("DELETE FROM webhooks")
    workspace.update(workspace.WorkspacePatch(**original))


@pytest.fixture
def captured(monkeypatch):
    sent: list[dict] = []

    def fake_send(url, body, headers):
        sent.append({"url": url, "body": body, "headers": headers})
        return 200

    monkeypatch.setattr(webhooks, "_send", fake_send)
    return sent


# ------------------------------------------------------------------ agentic actions
def test_cancel_is_offered_then_executed_on_confirmation(chat, client):
    convo = chat("CUST-004")
    offer = convo.send("please cancel my order")
    assert meta(offer)["action_proposal"]["type"] == "cancel_order"
    assert "Reply **yes**" in offer["message"]["content"]
    assert commerce.get_order("ORD-10460")["status"] == "processing"  # nothing happens without consent

    done = convo.send("yes please")
    assert meta(done)["route"] == ["intent_classifier", "action_agent", "memory_manager"]
    assert meta(done)["action_result"]["status"] == "executed"
    assert "is canceled" in done["message"]["content"]
    assert commerce.get_order("ORD-10460")["status"] == "canceled"

    actions = client.get("/api/admin/actions").json()
    assert actions[0]["type"] == "cancel_order" and actions[0]["requested_by"] == "ai"


def test_declined_offer_changes_nothing_and_expires(chat):
    convo = chat("CUST-001")
    offer = convo.send("I want to return the down jacket")
    assert meta(offer)["action_proposal"]["type"] == "start_return"
    declined = convo.send("no thanks")
    assert "left **ORD-10388** as it is" in declined["message"]["content"]
    assert commerce.get_order("ORD-10388")["status"] == "delivered"
    later = convo.send("yes")  # the offer was answered once; a stray "yes" must not act
    assert "action_agent" not in meta(later)["route"]


def test_offer_expires_when_customer_changes_topic(chat):
    convo = chat("CUST-001")
    convo.send("I want to return the down jacket")
    convo.send("do you ship to canada?")
    after = convo.send("yes")
    assert "action_agent" not in meta(after)["route"]
    assert commerce.get_order("ORD-10388")["status"] == "delivered"


def test_start_return_creates_rma(chat):
    convo = chat("CUST-001")
    convo.send("Can I return the down jacket?")
    done = convo.send("yes")
    order = commerce.get_order("ORD-10388")
    assert order["status"] == "return_in_progress" and order["return"]["rma"].startswith("RMA-")
    assert order["return"]["rma"] in done["message"]["content"]


def test_actions_can_be_disabled(chat):
    workspace.update(workspace.WorkspacePatch(auto_actions_enabled=False))
    offer = chat("CUST-004").send("please cancel my order")
    assert meta(offer)["action_proposal"] is None


def test_refund_over_limit_queues_approval_and_specialist_approves(chat, client):
    convo = chat("CUST-003")
    body = convo.send("I want a refund for ORD-10350")
    assert meta(body)["escalation_reason"] == "refund_approval"
    pending = meta(body)["action_result"]
    assert pending["status"] == "pending_approval" and pending["amount"] == 1248.05

    tickets = client.get("/api/admin/tickets").json()
    assert next(t for t in tickets if t["id"] == meta(body)["ticket_id"])["pending_actions"] == 1
    detail = client.get(f"/api/admin/tickets/{meta(body)['ticket_id']}").json()
    assert detail["actions"][0]["id"] == pending["id"]

    approved = client.post(f"/api/admin/actions/{pending['id']}/approve", json={"agent_name": "Alex"})
    assert approved.status_code == 200 and approved.json()["decided_by"] == "Alex"
    assert commerce.get_order("ORD-10350")["status"] == "refunded"

    messages = client.get(f"/api/conversations/{convo.id}").json()["messages"]
    specialist = [m for m in messages if m["role"] == "human_agent"][-1]
    assert "$1,248.05" in specialist["content"] and specialist["meta"]["action_result"]["status"] == "executed"
    assert db.get_ticket(meta(body)["ticket_id"])["status"] == "resolved"

    again = client.post(f"/api/admin/actions/{pending['id']}/approve", json={"agent_name": "Alex"})
    assert again.status_code == 409


def test_specialist_can_deny_with_note(chat, client):
    body = chat("CUST-003").send("I want a refund for ORD-10350")
    action_id = meta(body)["action_result"]["id"]
    denied = client.post(f"/api/admin/actions/{action_id}/deny", json={"agent_name": "Alex", "note": "We can offer store credit instead."})
    assert denied.json()["status"] == "denied"
    assert commerce.get_order("ORD-10350")["status"] == "delivered"
    messages = client.get(f"/api/conversations/{body['conversation']['id']}").json()["messages"]
    assert messages[-1]["content"] == "We can offer store credit instead."


# ------------------------------------------------------------------ workspace settings
def test_settings_update_applies_live(chat, client):
    res = client.patch("/api/admin/settings", json={"company_name": "Summit Supply", "accent_color": "#0f766e", "refund_approval_limit": 2000})
    assert res.status_code == 200
    config = client.get("/api/config").json()
    assert config["company_name"] == "Summit Supply" and config["accent_color"] == "#0f766e"

    body = chat("CUST-003").send("I want a refund for ORD-10350")
    assert not meta(body)["escalated"]  # under the new limit, no approval needed
    assert meta(body)["action_proposal"]["type"] == "start_return"


def test_settings_validation(client):
    assert client.patch("/api/admin/settings", json={"accent_color": "red"}).status_code == 422
    assert client.patch("/api/admin/settings", json={"confidence_threshold": 2}).status_code == 422
    assert client.patch("/api/admin/settings", json={"unknown": 1}).status_code == 422


# ------------------------------------------------------------------ multilingual
@pytest.mark.parametrize("text, expected", [
    ("Where is my order?", "en"),
    ("¿Dónde está mi pedido?", "es"),
    ("Où est ma commande ?", "fr"),
    ("Wo ist meine Bestellung?", "de"),
    ("मेरा ऑर्डर कहाँ है?", "hi"),
])
def test_language_detection(text, expected):
    assert detect_language(text) == expected


def test_short_messages_keep_conversation_language():
    assert detect_language("ORD-10421", previous="es") == "es"
    assert detect_language("ok", previous="fr") == "fr"


def test_spanish_customer_is_routed_and_language_recorded(chat, client):
    body = chat("CUST-001").send("¿Dónde está mi pedido?")
    assert meta(body)["intent"] == "order_status" and meta(body)["language"] == "es"
    assert "ORD-10421" in body["message"]["content"]
    assert "español" in body["message"]["content"]  # offline engine explains it replies in English
    assert body["conversation"]["language"] == "es"


# ------------------------------------------------------------------ knowledge insights
def test_knowledge_gaps_cluster_unanswered_questions(chat, client):
    chat("CUST-002").send("Do you sell bicycles?")
    chat("CUST-005").send("Do you sell electric bicycles?")
    chat("CUST-004").send("what's the capital of france")  # trivia is not a gap
    gaps = client.get("/api/admin/insights/knowledge-gaps").json()
    bikes = next(g for g in gaps if "bicycl" in g["top_terms"])
    assert bikes["count"] >= 2 and len(bikes["examples"]) >= 2
    assert not any("france" in " ".join(g["examples"]).lower() for g in gaps)

    draft = client.post("/api/admin/kb/drafts", json={"questions": bikes["examples"]}).json()
    assert draft["body"].startswith("# ") and "## " in draft["body"]


def test_article_draft_from_resolved_ticket_redacts_pii(chat, client):
    handoff = chat("CUST-004").send("I'd like to talk to a human please")
    ticket_id = meta(handoff)["ticket_id"]
    client.post(f"/api/admin/tickets/{ticket_id}/reply", json={
        "content": "Hi Sam, yes! You can rent kayaks at our Denver store for $45/day. Email sam.patel@example.com about ORD-10460.",
        "agent_name": "Alex", "resolve": True,
    })
    draft = client.post(f"/api/admin/kb/drafts/ticket/{ticket_id}").json()
    assert "$45/day" in draft["body"]
    assert "Sam" not in draft["body"] and "ORD-10460" not in draft["body"] and "@example.com" not in draft["body"]


# ------------------------------------------------------------------ copilot & macros
@pytest.mark.parametrize("mode", ["friendlier", "shorter", "formal", "empathetic", "fix_grammar"])
def test_copilot_offline_rewrites(client, mode):
    res = client.post("/api/admin/copilot/rewrite", json={"text": "hi sam i can't find ur order. it's not shipped yet. we'll check!", "mode": mode})
    assert res.status_code == 200 and res.json()["engine"] == "offline" and res.json()["text"]


def test_copilot_formal_expands_contractions(client):
    text = client.post("/api/admin/copilot/rewrite", json={"text": "Hi! We can't do that 😊", "mode": "formal"}).json()["text"]
    assert "cannot" in text and "😊" not in text and text.startswith("Hello")


def test_copilot_translation_requires_a_model(client):
    res = client.post("/api/admin/copilot/rewrite", json={"text": "Your refund is on its way.", "mode": "translate", "language": "es"})
    assert res.status_code == 422 and "LLM" in res.json()["detail"]


def test_macros_are_seeded_and_editable(client):
    macros = client.get("/api/admin/macros").json()
    assert len(macros) >= 4 and any("{first_name}" in m["body"] for m in macros)
    created = client.post("/api/admin/macros", json={"title": "Warranty", "body": "Hi {first_name}, our warranty covers..."}).json()
    assert client.put(f"/api/admin/macros/{created['id']}", json={"title": "Warranty v2", "body": "Updated"}).json()["title"] == "Warranty v2"
    assert client.delete(f"/api/admin/macros/{created['id']}").status_code == 200


# ------------------------------------------------------------------ webhooks & SLA
def test_signed_webhook_on_ticket_created(chat, client, captured):
    hook = client.post("/api/admin/webhooks", json={"name": "Ops", "url": "https://hooks.example.com/relay", "events": ["ticket.created"]}).json()
    assert hook["secret"].startswith("whsec_")
    chat("CUST-002").send("There's an unauthorized charge on my card")

    assert len(captured) == 1
    headers, body = captured[0]["headers"], captured[0]["body"]
    assert headers["X-Relay-Event"] == "ticket.created"
    assert webhooks.verify_signature(hook["secret"], headers["X-Relay-Timestamp"], body, headers["X-Relay-Signature"])
    log = client.get("/api/admin/webhooks").json()["deliveries"]
    assert log[0]["ok"] and log[0]["event"] == "ticket.created"


def test_slack_webhook_and_test_delivery(client, captured):
    hook = client.post("/api/admin/webhooks", json={"name": "Slack", "url": "https://hooks.slack.com/services/T/B/X", "kind": "slack",
                                                     "events": ["ticket.created"]}).json()
    result = client.post(f"/api/admin/webhooks/{hook['id']}/test").json()
    assert result["ok"] and '"text"' in captured[0]["body"] and "TCK-TEST01" in captured[0]["body"]


def test_webhook_validation(client):
    assert client.post("/api/admin/webhooks", json={"name": "x", "url": "ftp://nope", "events": ["ticket.created"]}).status_code == 422
    assert client.post("/api/admin/webhooks", json={"name": "x", "url": "https://ok.example", "events": ["made.up"]}).status_code == 422


def test_failed_delivery_is_logged(client, monkeypatch):
    def refuse(*_):
        raise ConnectionError("connection refused")

    monkeypatch.setattr(webhooks, "_send", refuse)
    hook = client.post("/api/admin/webhooks", json={"name": "Down", "url": "https://down.example", "events": ["ticket.created"]}).json()
    result = client.post(f"/api/admin/webhooks/{hook['id']}/test").json()
    assert not result["ok"] and "refused" in result["error"]


def test_sla_breach_alert_fires_once(chat, client, captured):
    client.post("/api/admin/webhooks", json={"name": "SLA", "url": "https://hooks.example.com/sla", "events": ["sla.breached"]})
    ticket_id = meta(chat("CUST-005").send("talk to a human"))["ticket_id"]
    db.update_ticket(ticket_id, sla_due_at="2020-01-01T00:00:00+00:00")
    assert client.post("/api/admin/sla/check").json()["breached"] >= 1
    assert any(ticket_id in c["body"] for c in captured)
    assert client.post("/api/admin/sla/check").json()["breached"] == 0


# ------------------------------------------------------------------ reporting
def test_analytics_include_roi_sla_and_automation(chat, client):
    convo = chat("CUST-004")
    convo.send("please cancel my order")
    convo.send("yes")
    stats = client.get("/api/admin/analytics").json()
    assert stats["automation"]["automated_actions"] >= 1
    assert stats["roi"]["hours_saved"] > 0 and stats["roi"]["cost_saved"] > 0
    assert {"compliance_rate", "avg_first_response_minutes", "breached"} <= stats["sla"].keys()
    assert stats["languages"]


def test_csv_exports(client):
    res = client.get("/api/admin/export/tickets.csv")
    assert res.status_code == 200 and res.headers["content-type"].startswith("text/csv")
    assert res.text.splitlines()[0].startswith("id,status,priority")
    assert client.get("/api/admin/export/conversations.csv").text.startswith("id,status,customer_id")
    assert client.get("/api/admin/export/secrets.csv").status_code == 422


def test_csv_neutralizes_formulas():
    from app.reporting import _cell

    assert _cell("=HYPERLINK(\"http://evil\")").startswith("'=")
    assert _cell("normal text") == "normal text"

def meta(body):
    return body["message"]["meta"]


def test_health_and_config(client):
    assert client.get("/api/health").json()["kb_documents"] >= 7
    assert client.get("/api/config").json()["provider"] == "offline"


def test_agent_route_and_kb_answer(chat):
    body = chat("CUST-004").send("do you ship to canada?")
    m = meta(body)
    assert m["route"] == ["intent_classifier", "knowledge_retriever", "support_agent", "memory_manager"]
    assert m["intent"] == "shipping_info"
    assert m["confidence"] >= 0.8 and not m["escalated"]
    assert "Canada" in body["message"]["content"]
    assert m["sources"][0]["id"].startswith("shipping#")


def test_signed_in_customer_order_is_auto_selected(chat):
    body = chat("CUST-001").send("where is my order?")
    assert "ORD-10421" in body["message"]["content"]
    assert meta(body)["action"] == "answer"


def test_anonymous_order_lookup_requires_email_verification(chat):
    convo = chat()
    first = convo.send("What's the status of ORD-10421?")
    assert meta(first)["action"] == "clarify"
    assert "1Z" not in first["message"]["content"]  # no tracking details leaked

    wrong = convo.send("jordan.alvarez@example.com")
    assert meta(wrong)["action"] == "clarify"
    assert "doesn't match" in wrong["message"]["content"]

    right = convo.send("sorry, it's maya.chen@example.com")
    assert "shipped" in right["message"]["content"]
    assert meta(right)["intent"] == "order_status"  # remembered from the first turn


def test_customer_cannot_see_other_customers_orders(chat):
    body = chat("CUST-002").send("where is ORD-10421?")
    assert "couldn't find" in body["message"]["content"]
    assert "Tent" not in body["message"]["content"]


def test_conversation_memory_follow_up_and_product_matching(chat):
    convo = chat("CUST-001")
    convo.send("where is my order?")
    body = convo.send("can I return the down jacket?")
    assert "ORD-10388" in body["message"]["content"]
    assert "eligible" in body["message"]["content"]


def test_refund_over_limit_escalates_with_ticket(chat, client):
    body = chat("CUST-003").send("I want a refund for ORD-10350")
    m = meta(body)
    assert m["escalated"] and m["escalation_reason"] == "refund_approval"
    assert m["route"][-2:] == ["escalation_agent", "memory_manager"]
    ticket = client.get(f"/api/admin/tickets/{m['ticket_id']}").json()
    assert ticket["ticket"]["category"] == "Returns"
    assert ticket["ticket"]["priority"] == "high"  # normal, bumped for Aurora+ VIP
    assert "ORD-10350" in ticket["ticket"]["summary"]


def test_hard_trigger_bypasses_generation(chat):
    body = chat("CUST-002").send("There is an unauthorized charge on my account")
    m = meta(body)
    assert m["route"] == ["intent_classifier", "escalation_agent", "memory_manager"]
    assert m["escalation_reason"] == "fraud_security"
    assert "Urgent" in body["message"]["content"]


def test_off_topic_is_declined_not_escalated(chat):
    body = chat("CUST-002").send("what's the capital of france")
    assert not meta(body)["escalated"]
    assert meta(body)["action"] == "clarify"


def test_human_handoff_round_trip(chat, client):
    convo = chat("CUST-004")
    convo.send("cancel my order")
    handoff = convo.send("I want to talk to a human")
    ticket_id = meta(handoff)["ticket_id"]
    assert handoff["conversation"]["status"] == "escalated"

    # While escalated, customer messages go to the ticket, not the AI.
    waiting = convo.send("hello? anyone there?")
    assert waiting["message"]["role"] == "system"

    reply = client.post(f"/api/admin/tickets/{ticket_id}/reply", json={"content": "Hi Sam, I've canceled ORD-10460 for you.", "agent_name": "Alex", "resolve": True})
    assert reply.status_code == 200 and reply.json()["ticket"]["status"] == "resolved"

    messages = client.get(f"/api/conversations/{convo.id}").json()["messages"]
    assert any(m["role"] == "human_agent" for m in messages)

    # Agent memory holds customer turns, AI replies, the queued message and the specialist reply.
    from app.agents.graph import get_graph

    state = get_graph().get_state({"configurable": {"thread_id": convo.id}}).values
    assert any(getattr(m, "name", None) == "human_agent" for m in state["messages"])
    assert any(m.content == "hello? anyone there?" for m in state["messages"])

    back = convo.send("thanks!")
    assert back["message"]["role"] == "assistant"
    assert back["conversation"]["status"] == "ai"


def test_streaming_endpoint_emits_agent_steps(client):
    with client.stream("POST", "/api/chat/stream", json={"message": "how do I reset my password?"}) as res:
        text = "".join(res.iter_text())
    assert "event: step" in text and "Intent Classifier" in text and "Knowledge Retriever" in text
    assert "event: message" in text and "event: done" in text


def test_knowledge_base_crud_reindexes(client):
    created = client.post("/api/admin/kb/documents", json={
        "title": "Gift Wrapping", "category": "orders",
        "body": "# Gift Wrapping\n\n## Gift wrap service\nWe offer recycled-paper gift wrapping for $4.95 per item at checkout.",
    })
    assert created.status_code == 200
    hits = client.post("/api/admin/kb/search", json={"query": "do you offer gift wrapping"}).json()
    assert hits[0]["doc_id"] == "gift_wrapping"
    assert client.delete("/api/admin/kb/documents/gift_wrapping").status_code == 200
    assert client.get("/api/admin/kb/documents/../../etc").status_code in (400, 404)


def test_feedback_and_analytics(chat, client):
    body = chat("CUST-005").send("how long does standard shipping take?")
    assert client.post(f"/api/conversations/{body['conversation']['id']}/feedback", json={"rating": 5}).status_code == 200
    stats = client.get("/api/admin/analytics").json()
    assert stats["total_conversations"] >= 1 and stats["csat_count"] >= 1
    assert stats["intents"]

"""Populate the console and analytics with realistic demo conversations.

    python -m app.seed
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from . import commerce, db, evals, workspace
from .auth import Principal
from .main import ChatRequest, TicketReply, reply_ticket, run_turn


def backdate(conversation_id: str, days: float) -> None:
    """Move a conversation into the past so Pulse has a baseline week to compare today against."""
    ts = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat(timespec="seconds")
    for table, column in (("messages", "conversation_id"), ("tickets", "conversation_id"), ("actions", "conversation_id")):
        db.execute(f"UPDATE {table} SET created_at = ? WHERE {column} = ?", (ts, conversation_id))
    db.execute("UPDATE conversations SET created_at = ?, updated_at = ? WHERE id = ?", (ts, ts, conversation_id))


def converse(customer_id: str | None, messages: list[str]) -> str:
    conversation_id: str | None = None
    for text in messages:
        for event in run_turn(ChatRequest(message=text, conversation_id=conversation_id, customer_id=customer_id)):
            if event["type"] == "conversation":
                conversation_id = event["conversation"]["id"]
    assert conversation_id
    return conversation_id


def main() -> None:
    db.conn()
    workspace.apply_overrides()
    commerce.reset_order_state()
    db.execute("DELETE FROM actions")

    resolved_by_ai = [
        ("CUST-001", ["Hi!", "Where is my order?", "How do I wash a down jacket?"], 5),
        ("CUST-005", ["Do you ship to Canada?", "What about kayaks?"], 5),
        ("CUST-004", ["Please cancel my order", "yes"], 5),  # agentic action: AI cancels after confirmation
        (None, ["How long do refunds take?"], None),
        ("CUST-002", ["What payment methods do you accept?"], 4),
        ("CUST-001", ["¿Dónde está mi pedido?"], 4),  # multilingual
    ]
    for customer, messages, rating in resolved_by_ai:
        cid = converse(customer, messages)
        if rating:
            db.update_conversation(cid, csat=rating)

    # Knowledge gaps: questions the help center can't answer yet.
    for customer, question in [("CUST-002", "Do you sell bicycles?"), ("CUST-005", "Do you sell electric bicycles?"),
                               (None, "Do you sell bike helmets?")]:
        converse(customer, [question])

    converse("CUST-003", ["I want a refund for ORD-10350"])  # pending refund approval in the console
    converse(None, ["Where is ORD-10397?", "jordan.alvarez@example.com"])
    converse("CUST-002", ["There's an unauthorized charge on my card!"])

    handled = converse("CUST-004", ["I'd like to talk to a human please"])
    ticket = db.open_ticket_for_conversation(handled)
    if ticket:
        reply_ticket(ticket["id"], TicketReply(content="Hi Sam, Alex here — happy to help. What can I do for you?", agent_name="Alex", resolve=True),
                     principal=Principal(kind="open", role="admin"))
        db.update_conversation(handled, csat=5)

    # Pulse: a normal week of traffic (one damaged-item contact in 7 days)...
    baseline = [
        ("CUST-002", "Do you ship to Canada?"), ("CUST-005", "How long does standard shipping take?"),
        ("CUST-001", "What's your return policy?"), (None, "How do I reset my password?"),
        ("CUST-004", "Where is my order?"), ("CUST-002", "What payment methods do you accept?"),
        ("CUST-005", "My jacket zipper arrived broken"),
    ]
    for day, (customer, question) in enumerate(baseline, start=1):
        backdate(converse(customer, [question]), day + 0.3)
    # ...then today's surge: a bad batch of stoves arriving damaged.
    for customer, messages in [
        ("CUST-005", ["My new stove arrived damaged", "ORD-10433"]),
        ("CUST-002", ["The camping stove I got is broken out of the box"]),
        ("CUST-004", ["My stove arrived cracked, this is ridiculous"]),
        (None, ["Received a damaged stove, the burner is bent"]),
    ]:
        converse(customer, messages)

    # Customer health: an unhappy repeat contact.
    unhappy = converse("CUST-002", ["Still no update on my issue, this is useless", "I want to talk to a manager"])
    db.update_conversation(unhappy, csat=1)

    # Test Lab: one baseline run so the page shows results immediately.
    evals.seed_builtin_scenarios()
    run = evals.start_run(None, triggered_by="Demo seed", wait=True)

    stats = db.analytics()
    print(f"Seeded {stats['total_conversations']} conversations, {stats['open_tickets']} open tickets, "
          f"Test Lab {run['passed']}/{run['total']} passing.")


if __name__ == "__main__":
    main()

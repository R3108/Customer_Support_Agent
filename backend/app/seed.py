"""Populate the console and analytics with realistic demo conversations.

    python -m app.seed
"""

from __future__ import annotations

from . import commerce, db, workspace
from .main import ChatRequest, TicketReply, reply_ticket, run_turn


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
        reply_ticket(ticket["id"], TicketReply(content="Hi Sam, Alex here — happy to help. What can I do for you?", agent_name="Alex", resolve=True))
        db.update_conversation(handled, csat=5)

    stats = db.analytics()
    print(f"Seeded {stats['total_conversations']} conversations, {stats['open_tickets']} open tickets.")


if __name__ == "__main__":
    main()

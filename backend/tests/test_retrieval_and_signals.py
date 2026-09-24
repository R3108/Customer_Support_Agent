import pytest

from app.agents.confidence import score_confidence
from app.agents.intents import classify_offline
from app.agents.signals import detect_sentiment, detect_signals, extract_entities
from app.rag import get_retriever


@pytest.mark.parametrize(
    "query, expected_chunk",
    [
        ("do you ship to canada", "shipping#international-and-canada-shipping"),
        ("how do I reset my password", "account_membership#resetting-your-password"),
        ("I was charged twice", "billing_payments#duplicate-or-unexpected-charges"),
        ("how do i wash my down jacket", "products_warranty#down-product-care"),
        ("can I use two promo codes", "billing_payments#promo-codes-and-discounts"),
        ("is my package lost", "shipping#delayed-or-lost-packages"),
    ],
)
def test_retriever_finds_relevant_passage(query, expected_chunk):
    hits = get_retriever().search(query)
    assert hits and hits[0].chunk.id == expected_chunk
    assert hits[0].score >= 0.75


def test_retriever_scores_off_topic_low():
    hits = get_retriever().search("what's the capital of france")
    assert not hits or hits[0].score < 0.45


@pytest.mark.parametrize(
    "text, intent",
    [
        ("where is my order?", "order_status"),
        ("I want to return these boots", "returns_refunds"),
        ("please cancel my order", "cancel_modify_order"),
        ("my tent arrived damaged", "damaged_or_wrong_item"),
        ("how many rewards points do I have", "membership_rewards"),
        ("hello", "greeting"),
    ],
)
def test_offline_intent_classifier(text, intent):
    assert classify_offline(text).intent == intent


def test_entity_extraction():
    ents = extract_entities("My order ord 10421 — email me at Maya.Chen@example.com")
    assert ents["active_order_id"] == "ORD-10421"
    assert ents["email"] == "maya.chen@example.com"


def test_hard_triggers_and_sentiment():
    assert "human_request" in detect_signals("can I talk to a real person")["hard_triggers"]
    assert "fraud_security" in detect_signals("there's an unauthorized charge on my card")["hard_triggers"]
    assert "legal_chargeback" in detect_signals("I'm filing a chargeback")["hard_triggers"]
    assert detect_signals("where is my order")["hard_triggers"] == []
    assert detect_sentiment("This is ridiculous and unacceptable") == "angry"
    assert detect_sentiment("thanks, that was helpful") == "positive"


@pytest.mark.parametrize("text", [
    "My tent pole snapped and cut my hand",
    "the stove sparked and my son got hurt",
    "I'm bleeding from the zipper",
    "the heater gave me an electric shock",
])
def test_everyday_injury_reports_trigger_safety(text):
    assert "safety" in detect_signals(text)["hard_triggers"]


@pytest.mark.parametrize("text", ["please cut my order in half", "the price hurt my wallet", "my back order is late"])
def test_safety_trigger_ignores_non_injuries(text):
    assert "safety" not in detect_signals(text)["hard_triggers"]


def test_confidence_blending():
    high, _ = score_confidence(intent="order_status", intent_confidence=0.9, retrieval_confidence=0.3, grounded=True,
                               generation_confidence=0.9, sentiment="neutral", action="answer")
    low, breakdown = score_confidence(intent="general_inquiry", intent_confidence=0.35, retrieval_confidence=0.2, grounded=False,
                                      generation_confidence=0.25, sentiment="angry", action="answer")
    clarify, _ = score_confidence(intent="order_status", intent_confidence=0.4, retrieval_confidence=0.1, grounded=False,
                                  generation_confidence=0.5, sentiment="neutral", action="clarify")
    assert high > 0.85
    assert low < 0.4 and breakdown["sentiment_penalty"] > 0
    assert clarify == 0.65

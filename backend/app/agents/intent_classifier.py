"""Intent Classifier agent.

Determines what the customer wants, how they feel, and whether a hard escalation
trigger fired. Also rewrites follow-ups ("what about Canada?") into standalone search
queries using conversation memory.
"""

from __future__ import annotations

import re
from typing import Literal

from langchain_core.messages import HumanMessage, SystemMessage
from pydantic import BaseModel, Field

from ..actions import ACTION_TYPES, AFFIRMATIVE, NEGATIVE
from ..config import get_settings
from ..i18n import detect_language, normalize
from ..llm import structured_call
from .confidence import clamp01
from .intents import INTENT_NAMES, INTENTS, classify_offline
from .memory import last_customer_message, previous_customer_message, transcript
from .signals import detect_sentiment, detect_signals, extract_entities
from .state import SupportState

FOLLOW_UP = re.compile(r"^(and|also|what about|how about|ok(ay)?|so|then|but|what if)\b|\b(it|that|this one|the other|them)\b", re.I)
URGENCY_BY_SENTIMENT = {"angry": "high", "negative": "normal", "neutral": "normal", "positive": "low"}


class IntentResult(BaseModel):
    intent: Literal[INTENT_NAMES] = Field(description="The customer's primary intent for their latest message.")  # type: ignore[valid-type]
    confidence: float = Field(description="Probability the intent label is correct, from 0.0 to 1.0.")
    sentiment: Literal["positive", "neutral", "negative", "angry"]
    urgency: Literal["low", "normal", "high", "urgent"]
    standalone_query: str = Field(description="The latest customer request rewritten in ENGLISH as a self-contained search query, resolving references using the conversation.")
    language: str = Field(description="ISO 639-1 code of the language the latest customer message is written in, e.g. en, es, fr, de, hi.")
    reasoning: str = Field(description="One short sentence explaining the classification.")


def _intent_catalog() -> str:
    return "\n".join(f"- {name}: {meta['label']}" for name, meta in INTENTS.items())


def intent_classifier(state: SupportState) -> dict:
    settings = get_settings()
    messages = state.get("messages", [])
    text = last_customer_message(messages)
    memory = state.get("entities") or {}

    entities = extract_entities(text)
    if entities.get("active_order_id"):
        entities["active_order_source"] = "explicit"
    signals = detect_signals(text)
    signals["mentioned_order_ids"] = entities.get("order_ids", [])
    signals["text"] = text
    sentiment = detect_sentiment(text)
    language = detect_language(text, memory.get("language"))

    # A yes/no reply to an action the assistant offered last turn goes straight to the Action Agent.
    pending = memory.get("pending_action") or {}
    if pending and not signals["hard_triggers"] and (AFFIRMATIVE.search(text) or NEGATIVE.search(text)):
        signals["action_confirmation"] = "confirm" if AFFIRMATIVE.search(text) else "decline"
        return {
            "intent": ACTION_TYPES.get(pending.get("type", ""), {}).get("intent", memory.get("last_intent") or "general_inquiry"),
            "intent_confidence": 0.95,
            "sentiment": sentiment,
            "urgency": "normal",
            "standalone_query": text,
            "signals": signals,
            "entities": {**entities, "language": language},
            "language": language,
            "escalate": False,
            "escalation_reason": "",
            "escalation_detail": "",
            "mode": state.get("mode") or "offline",
        }

    llm_result = structured_call(
        IntentResult,
        [
            SystemMessage(
                f"You are the intent classifier for {settings.company_name}'s customer support assistant.\n"
                f"Intents:\n{_intent_catalog()}\n\n"
                "Rules: messages that only supply an order number or email usually continue the previous request — "
                "reuse the previous intent. 'human_handoff' only when the customer explicitly asks for a person. "
                "Use 'general_inquiry' for anything outside retail customer support."
            ),
            HumanMessage(
                f"Conversation summary: {state.get('memory_summary') or '(none)'}\n"
                f"Known entities: {memory}\n"
                f"Recent conversation:\n{transcript(messages[:-1], 8) or '(start of conversation)'}\n\n"
                f"Latest customer message: {text}"
            ),
        ],
    )

    if llm_result:
        intent, confidence = llm_result.intent, llm_result.confidence
        # Keep the stronger of the model's and the lexicon's negative-sentiment reading.
        severity = ["positive", "neutral", "negative", "angry"]
        sentiment = max(llm_result.sentiment, sentiment, key=severity.index)
        urgency = llm_result.urgency
        query = llm_result.standalone_query or text
        language = normalize(llm_result.language) or language
        mode = "llm"
    else:
        guess = classify_offline(text)
        intent, confidence = guess.intent, guess.confidence
        stripped = extract_entities(text)
        only_identifiers = bool(stripped) and len(re.sub(r"ORD[-\s]?\d{5}|\S+@\S+|[^a-zA-Z]", " ", text).split()) <= 4
        last_intent = memory.get("last_intent")
        if last_intent and (only_identifiers or (intent == "general_inquiry" and FOLLOW_UP.search(text))):
            # Customer is answering our clarifying question or following up on the previous topic.
            intent, confidence = last_intent, 0.8 if only_identifiers else 0.62
        query = text
        if FOLLOW_UP.search(text) or len(text.split()) <= 4:
            query = f"{previous_customer_message(messages)} {text}".strip()
        urgency = URGENCY_BY_SENTIMENT.get(sentiment, "normal")
        mode = "offline"

    hard = signals.get("hard_triggers", [])
    if "human_request" in hard:
        intent, confidence = "human_handoff", max(confidence, 0.95)
    if signals.get("damaged_or_wrong") and intent in ("general_inquiry", "order_status", "product_question"):
        intent = "damaged_or_wrong_item"
    if {"fraud_security", "safety"} & set(hard):
        urgency = "urgent"

    escalation_reason = ""
    for trigger in ("safety", "fraud_security", "legal_chargeback", "human_request"):
        if trigger in hard:
            escalation_reason = trigger
            break

    policy_updates: dict = {}
    if escalation_reason:
        # Hard triggers bypass answer generation; the routing decision itself is certain.
        policy_updates = {
            "confidence": 1.0,
            "confidence_breakdown": {"policy_trigger": escalation_reason, "matched": signals.get(escalation_reason), "final": 1.0},
        }

    return {
        **policy_updates,
        "intent": intent,
        "intent_confidence": round(clamp01(confidence), 3),
        "sentiment": sentiment,
        "urgency": urgency,
        "standalone_query": query,
        "signals": signals,
        "entities": {**entities, "language": language},
        "language": language,
        "escalate": bool(escalation_reason),
        "escalation_reason": escalation_reason,
        "escalation_detail": signals.get(escalation_reason, "") if escalation_reason else "",
        "mode": mode,
    }

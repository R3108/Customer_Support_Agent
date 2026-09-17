"""Deterministic signal detection: entities, sentiment and hard escalation triggers.

These run in both LLM and offline mode. Safety-critical routing (fraud, legal, injury,
explicit human requests) never depends on a model's judgement alone.
"""

from __future__ import annotations

import re
from typing import Any

ORDER_ID = re.compile(r"\bORD[-\s]?(\d{5})\b", re.IGNORECASE)
BARE_ORDER_NUM = re.compile(r"(?:order|#)\s*(?:number|no\.?|id)?\s*#?\s*(\d{5})\b", re.IGNORECASE)
EMAIL = re.compile(r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b")


def _any(patterns: list[str], text: str) -> str | None:
    for p in patterns:
        m = re.search(p, text, re.IGNORECASE)
        if m:
            return m.group(0)
    return None


HARD_TRIGGERS: dict[str, list[str]] = {
    "human_request": [
        r"\b(speak|talk|chat)\s+(to|with)\s+(a\s+|an\s+|the\s+|your\s+)?(human|person|someone|agent|representative|rep|manager|supervisor|specialist)\b",
        r"\b(real|live|actual)\s+(human|person|agent)\b",
        r"\bhuman\s+(agent|support|being|please)\b",
        r"\b(get|connect|transfer)\s+me\s+(to\s+)?(a\s+|an\s+)?(human|person|agent|representative|manager|supervisor)\b",
        r"^\s*(human|agent|representative|operator)\s*[.!?]*\s*$",
        r"\b(escalate|escalation)\b",
    ],
    "fraud_security": [
        r"\bunauthori[sz]ed\b",
        r"\bfraud(ulent)?\b",
        r"\b(hacked|compromised)\b",
        r"\b(didn'?t|did not|never)\s+(place|make|order|authori[sz]e)\b",
        r"\bstolen\s+(card|account|identity)\b",
        r"\bidentity theft\b",
    ],
    "legal_chargeback": [
        r"\bcharge\s?back\b",
        r"\b(lawyer|attorney|lawsuit|legal action|small claims|sue you|suing)\b",
        r"\bbetter business bureau\b|\bBBB\b",
        r"\bdispute\s+(the\s+|this\s+)?(charge|with my bank)\b",
    ],
    "safety": [
        r"\binjur(y|ed|ies)\b",
        r"\b(caught|catch|on)\s+fire\b",
        r"\b(burned|burnt|burns)\b",
        r"\b(hospital|emergency room|unsafe|hazard|exploded|explode|carbon monoxide)\b",
    ],
}

SOFT_SIGNALS: dict[str, list[str]] = {
    "delivered_not_received": [
        r"\b(marked|says|shows)\s+(as\s+)?delivered\b.*\b(not|never|didn'?t|haven'?t)\b",
        r"\b(not|never|didn'?t|haven'?t)\b.*\b(received|arrived|got)\b.*\bdelivered\b",
    ],
    "damaged_or_wrong": [
        r"\b(damaged|broken|defective|torn|ripped|cracked|faulty|snapped|leaking|leaks)\b",
        r"\bwrong\s+(item|size|color|colour|product|order)\s+(was\s+)?(sent|received|arrived|delivered)\b",
        r"\b(received|got|sent me)\s+(the\s+)?wrong\b",
        r"\bmissing\s+(item|piece|part)s?\b",
    ],
    "frustration": [
        r"\b(didn'?t|doesn'?t|does not|did not|not)\s+(help|answer|work)\b",
        r"\b(useless|pointless|waste of time|not helpful|unhelpful|you('re| are) not listening)\b",
        r"\b(again|still)\b.*\b(no|nothing|not)\b",
    ],
    "refund_request": [
        r"\b(refund|money back|reimburse)\b",
    ],
    # Prompt-injection attempts and unrelated generation tasks: never handed to the model to answer.
    "out_of_scope": [
        r"\b(ignore|disregard|forget|override)\s+(all\s+|any\s+|your\s+|the\s+|my\s+|previous\s+|prior\s+|above\s+|earlier\s+)*(instructions|rules|prompts?|guidelines|guardrails)\b",
        r"\b(system|developer|hidden)\s+(prompt|instructions|message)\b",
        r"\b(jailbreak|DAN mode|developer mode)\b",
        r"\bpretend\s+(to\s+be|you\s+are|you're)\b",
        r"\b(write|generate|compose)\s+(me\s+)?(a\s+|an\s+|some\s+)?(\w+\s+){0,3}(poem|essay|story|song|lyrics|haiku|joke|script|python|javascript|sql)\b",
        r"\b(python|javascript|java|c\+\+|sql)\s+(code|function|program|script)\b",
    ],
}

NEGATIVE_WORDS = {
    "angry": ["furious", "livid", "outraged", "unacceptable", "ridiculous", "disgusting", "worst", "scam",
              "pathetic", "terrible service", "fed up", "never again", "horrible", "wtf", "!!!"],
    "negative": ["disappointed", "frustrated", "annoyed", "upset", "unhappy", "bad", "poor", "late", "still waiting",
                 "not happy", "problem", "issue", "wrong", "broken", "damaged", "delayed", "lost"],
    "positive": ["thanks", "thank you", "great", "awesome", "perfect", "love", "appreciate", "helpful", "amazing"],
}


def extract_entities(text: str) -> dict[str, Any]:
    entities: dict[str, Any] = {}
    order_ids = [f"ORD-{m}" for m in ORDER_ID.findall(text)]
    if not order_ids:
        order_ids = [f"ORD-{m}" for m in BARE_ORDER_NUM.findall(text)]
    if order_ids:
        entities["order_ids"] = list(dict.fromkeys(order_ids))
        entities["active_order_id"] = order_ids[-1]
    emails = EMAIL.findall(text)
    if emails:
        entities["email"] = emails[-1].lower()
    return entities


def detect_sentiment(text: str) -> str:
    lowered = text.lower()
    caps_ratio = sum(1 for ch in text if ch.isupper()) / max(sum(1 for ch in text if ch.isalpha()), 1)
    if any(w in lowered for w in NEGATIVE_WORDS["angry"]) or (caps_ratio > 0.6 and len(text) > 12):
        return "angry"
    if any(re.search(rf"\b{re.escape(w)}\b", lowered) for w in NEGATIVE_WORDS["negative"]):
        return "negative"
    if any(w in lowered for w in NEGATIVE_WORDS["positive"]):
        return "positive"
    return "neutral"


def detect_signals(text: str) -> dict[str, Any]:
    signals: dict[str, Any] = {}
    for name, patterns in {**HARD_TRIGGERS, **SOFT_SIGNALS}.items():
        match = _any(patterns, text)
        if match:
            signals[name] = match
    hard = [name for name in HARD_TRIGGERS if name in signals]
    signals["hard_triggers"] = hard
    return signals

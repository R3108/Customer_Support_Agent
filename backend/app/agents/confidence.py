"""Confidence scoring.

The final score blends four independent signals so no single component (for example
an over-confident LLM) can push a weak answer past the escalation threshold:

    confidence = 0.20·intent + 0.35·evidence + 0.45·generation − sentiment penalty

* intent      – classifier certainty
* evidence    – best of knowledge-base relevance and account-data grounding
* generation  – the support agent's self-assessment (LLM) or rule certainty (offline)
"""

from __future__ import annotations

from typing import Any

WEIGHTS = {"intent": 0.20, "evidence": 0.35, "generation": 0.45}
SENTIMENT_PENALTY = {"negative": 0.04, "angry": 0.10}
NO_EVIDENCE_NEEDED = {"greeting"}


def clamp01(value: float) -> float:
    """Model-reported scores are clamped rather than schema-constrained (strict JSON schema portability)."""
    return max(0.0, min(1.0, float(value)))


def score_confidence(
    *,
    intent: str,
    intent_confidence: float,
    retrieval_confidence: float,
    grounded: bool,
    generation_confidence: float,
    sentiment: str,
    action: str,
) -> tuple[float, dict[str, Any]]:
    grounding = 0.95 if grounded else 0.0
    evidence = 1.0 if intent in NO_EVIDENCE_NEEDED else max(retrieval_confidence, grounding)
    raw = (
        WEIGHTS["intent"] * intent_confidence
        + WEIGHTS["evidence"] * evidence
        + WEIGHTS["generation"] * generation_confidence
    )
    penalty = SENTIMENT_PENALTY.get(sentiment, 0.0)
    final = raw - penalty
    floor_applied = False
    if action == "clarify" and final < 0.65:
        # Asking a targeted clarifying question is a safe, low-risk action.
        final = 0.65
        floor_applied = True
    final = round(max(0.0, min(1.0, final)), 3)
    return final, {
        "intent": round(intent_confidence, 3),
        "retrieval": round(retrieval_confidence, 3),
        "grounding": round(grounding, 3),
        "evidence": round(evidence, 3),
        "generation": round(generation_confidence, 3),
        "sentiment_penalty": penalty,
        "clarify_floor": floor_applied,
        "weights": WEIGHTS,
        "final": final,
    }

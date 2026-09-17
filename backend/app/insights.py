"""Self-improving knowledge base.

* Knowledge gaps: in-scope customer questions the help center couldn't answer, clustered
  so the team can see what's missing and how often it's asked.
* Article drafts: turn a gap cluster or a specialist's resolved ticket into a help-center
  article draft (PII redacted) for review in the Knowledge base editor.
"""

from __future__ import annotations

import hashlib
import re
from collections import Counter
from typing import Any

from langchain_core.messages import HumanMessage, SystemMessage
from pydantic import BaseModel, Field

from . import db
from .agents.intents import INTENTS, classify_offline
from .config import get_settings
from .llm import structured_call
from .rag.retriever import tokenize

SIMILARITY = 0.34


# ---------------------------------------------------------------- gaps
def _gap_questions(days: int) -> list[dict[str, Any]]:
    rows = db.query(
        """SELECT m.id, m.conversation_id, m.meta, m.created_at,
                  (SELECT c.content FROM messages c WHERE c.conversation_id = m.conversation_id AND c.role = 'customer'
                   AND c.id < m.id ORDER BY c.id DESC LIMIT 1) AS question
           FROM messages m
           WHERE m.role = 'assistant' AND m.created_at >= datetime('now', ?)
           ORDER BY m.id DESC""",
        (f"-{days} days",),
    )
    return [r for r in rows if r["meta"].get("knowledge_gap") and r["question"]]


def knowledge_gaps(days: int = 30, limit: int = 12) -> list[dict[str, Any]]:
    clusters: list[dict[str, Any]] = []
    for row in _gap_questions(days):
        text = row["meta"].get("query") or row["question"]
        terms = set(tokenize(text))
        if not terms:
            continue
        best, best_sim = None, 0.0
        for cluster in clusters:
            sim = len(terms & cluster["terms"]) / len(terms | cluster["terms"])
            if sim > best_sim:
                best, best_sim = cluster, sim
        if best is None or best_sim < SIMILARITY:
            best = {"terms": set(), "term_counts": Counter(), "questions": [], "intents": Counter(), "last_seen": row["created_at"],
                    "conversations": set()}
            clusters.append(best)
        best["terms"] |= terms
        best["term_counts"].update(terms)
        best["intents"][row["meta"].get("intent") or "general_inquiry"] += 1
        best["conversations"].add(row["conversation_id"])
        best["last_seen"] = max(best["last_seen"], row["created_at"])
        if row["question"] not in best["questions"]:
            best["questions"].append(row["question"])

    result = []
    for c in clusters:
        key = " ".join(sorted(t for t, _ in c["term_counts"].most_common(4)))
        result.append({
            "id": hashlib.sha1(key.encode()).hexdigest()[:10],
            "title": c["questions"][0][:120],
            "count": sum(c["intents"].values()),
            "conversations": len(c["conversations"]),
            "examples": c["questions"][:5],
            "top_terms": [t for t, _ in c["term_counts"].most_common(5)],
            "intent": c["intents"].most_common(1)[0][0],
            "last_seen": c["last_seen"],
        })
    result.sort(key=lambda g: g["last_seen"], reverse=True)
    result.sort(key=lambda g: g["count"], reverse=True)  # stable: most asked first, then most recent
    return result[:limit]


# ---------------------------------------------------------------- drafts
class ArticleDraft(BaseModel):
    title: str = Field(description="Short help-center article title.")
    category: str = Field(description="One of: shipping, returns, orders, billing, account, product, support, general.")
    body: str = Field(description="Markdown article: '# Title', then one '## ' section per topic with concise, customer-facing answers.")


PII = [
    (re.compile(r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b"), "[email]"),
    (re.compile(r"\bORD[-\s]?\d{5}\b", re.I), "your order"),
    (re.compile(r"\bTCK-[A-F0-9]{6}\b"), "your ticket"),
    (re.compile(r"\b(?:\d[ -]?){12,19}\b"), "[number]"),
]
PHONE_LIKE = re.compile(r"\+?\d[\d\s().-]{8,}\d")
GREETING = re.compile(r"^(hi|hello|hey|dear)\b[^,.!\n]*[,.!]?\s*", re.I)
SIGN_OFF = re.compile(r"\n*[—-]\s*\w[\w\s]*$")


def redact(text: str) -> str:
    for pattern, repl in PII:
        text = pattern.sub(repl, text)
    # Phone numbers have 10+ digits; dates and prices don't.
    return PHONE_LIKE.sub(lambda m: "[phone]" if sum(ch.isdigit() for ch in m.group(0)) >= 10 else m.group(0), text)


def _category_for(text: str) -> str:
    intent = classify_offline(text).intent
    return INTENTS.get(intent, {}).get("kb_category") or "general"


def _slug_category(value: str) -> str:
    value = re.sub(r"[^a-z0-9_-]+", "-", value.lower()).strip("-")[:40]
    return value or "general"


def _title_from(question: str) -> str:
    q = re.sub(r"\s+", " ", redact(question)).strip().rstrip("?.! ")
    return (q[:1].upper() + q[1:])[:90] if q else "New article"


def _llm_draft(instructions: str, material: str) -> dict[str, Any] | None:
    result = structured_call(
        ArticleDraft,
        [
            SystemMessage(
                f"You write help-center articles for {get_settings().company_name}. {instructions} "
                "Use ONLY facts in the material. Where a fact is missing, write a clearly marked TODO for the team. "
                "Never include customer names, emails, order numbers or other personal data."
            ),
            HumanMessage(material),
        ],
    )
    if not result:
        return None
    return {"title": result.title[:120], "category": _slug_category(result.category), "body": redact(result.body), "engine": "llm"}


def draft_from_questions(questions: list[str]) -> dict[str, Any]:
    questions = [redact(q.strip()) for q in questions if q.strip()][:8]
    drafted = _llm_draft(
        "Draft an article that answers this cluster of real customer questions the current help center could not answer.",
        "Customer questions:\n" + "\n".join(f"- {q}" for q in questions),
    )
    if drafted:
        return drafted
    title = _title_from(questions[0]) if questions else "New article"
    sections = "\n\n".join(f"## {_title_from(q)}\nTODO: write the answer customers need." for q in dict.fromkeys(questions))
    return {"title": title, "category": _category_for(" ".join(questions)), "body": f"# {title}\n\n{sections}\n", "engine": "offline"}


def draft_from_ticket(ticket: dict[str, Any], messages: list[dict[str, Any]]) -> dict[str, Any]:
    customer_turns = [m["content"] for m in messages if m["role"] == "customer"]
    specialist_turns = [m["content"] for m in messages if m["role"] == "human_agent"]
    material = (
        f"Ticket reason: {ticket.get('reason')}\n\nCustomer messages:\n" + "\n".join(f"- {redact(c)}" for c in customer_turns)
        + "\n\nSpecialist replies (the source of truth):\n" + "\n".join(f"- {redact(s)}" for s in specialist_turns)
    )
    drafted = _llm_draft("Turn how a specialist resolved this ticket into a reusable article so the AI can answer it next time.", material)
    if drafted:
        return drafted
    question = customer_turns[0] if customer_turns else (ticket.get("reason") or "Support question")
    title = _title_from(question)
    answers = [SIGN_OFF.sub("", GREETING.sub("", redact(s))).strip() for s in specialist_turns]
    answer = "\n\n".join(a for a in answers if a) or "TODO: add the answer your team gave the customer."
    return {"title": title, "category": _category_for(" ".join(customer_turns) or title), "body": f"# {title}\n\n## {title}\n{answer}\n",
            "engine": "offline"}

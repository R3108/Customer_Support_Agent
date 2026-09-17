"""Specialist copilot: rewrite and translate replies in the console.

Uses the configured model; offline mode applies deterministic rewrites so the console
stays useful without an API key (translation genuinely needs a model).
"""

from __future__ import annotations

import re
from typing import Literal

from langchain_core.messages import HumanMessage, SystemMessage
from pydantic import BaseModel, Field

from .config import get_settings
from .i18n import language_name, translate
from .llm import structured_call

Mode = Literal["friendlier", "shorter", "formal", "empathetic", "fix_grammar", "translate"]

INSTRUCTIONS: dict[str, str] = {
    "friendlier": "Make it warmer and more personable while staying professional.",
    "shorter": "Make it about half as long. Keep every fact, number, order id and next step.",
    "formal": "Make it more formal and polished. No slang or emoji.",
    "empathetic": "Acknowledge the customer's frustration sincerely before the substance. Don't over-apologize.",
    "fix_grammar": "Fix spelling, grammar and punctuation only. Change nothing else.",
}
CONTRACTIONS = {
    "can't": "cannot", "won't": "will not", "don't": "do not", "doesn't": "does not", "didn't": "did not", "isn't": "is not",
    "aren't": "are not", "I'm": "I am", "I've": "I have", "I'll": "I will", "we're": "we are", "we'll": "we will",
    "you're": "you are", "it's": "it is", "that's": "that is", "there's": "there is", "let's": "let us",
}
EMOJI = re.compile("[\U0001F300-\U0001FAFF☀-➿]")


class CopilotUnavailable(Exception):
    pass


class Rewrite(BaseModel):
    text: str = Field(description="The rewritten reply. Keep Markdown, order numbers, amounts and links unchanged.")


def rewrite(text: str, mode: Mode, language: str | None = None, context: str = "") -> tuple[str, str]:
    """Return (text, engine) where engine is 'llm' or 'offline'."""
    if mode == "translate":
        target = language or "en"
        translated = translate(text, target)
        if translated is None:
            raise CopilotUnavailable("Translation needs an LLM provider — set ANTHROPIC_API_KEY or OPENAI_API_KEY.")
        return translated, "llm"

    result = structured_call(
        Rewrite,
        [
            SystemMessage(
                f"You help human support specialists at {get_settings().company_name} polish replies to customers. "
                f"{INSTRUCTIONS[mode]} Never add promises, policies or facts that aren't in the original. Reply in the same language."
            ),
            HumanMessage((f"Conversation context:\n{context}\n\n" if context else "") + f"Reply to rewrite:\n{text}"),
        ],
    )
    if result and result.text.strip():
        return result.text.strip(), "llm"
    return offline_rewrite(text, mode), "offline"


def offline_rewrite(text: str, mode: str) -> str:
    text = text.strip()
    if mode == "shorter":
        sentences = re.split(r"(?<=[.!?])\s+", re.sub(r"\s+", " ", text))
        filler = re.compile(r"\b(just|really|actually|basically|very|quite|simply|definitely)\s+", re.I)
        return filler.sub("", " ".join(sentences[: max(2, len(sentences) // 2)])).strip()
    if mode == "friendlier":
        body = text if re.match(r"^(hi|hello|hey)\b", text, re.I) else f"Hi there! {text}"
        return body if re.search(r"(anything else|let me know)", body, re.I) else f"{body}\n\nLet me know if there's anything else I can do for you!"
    if mode == "formal":
        out = EMOJI.sub("", text)
        for short, full in CONTRACTIONS.items():
            out = re.sub(rf"\b{re.escape(short)}\b", full, out)
            out = re.sub(rf"\b{re.escape(short.capitalize())}\b", full.capitalize(), out)
        return re.sub(r"^(hi|hey)\b", "Hello", out, flags=re.I).replace("!", ".").strip()
    if mode == "empathetic":
        if re.search(r"\b(sorry|apologi[sz]e|understand how)\b", text, re.I):
            return text
        return f"I'm really sorry for the trouble this has caused, and I appreciate your patience. {text}"
    if mode == "fix_grammar":
        out = re.sub(r"\s+([,.!?])", r"\1", re.sub(r"[ \t]+", " ", text))
        out = re.sub(r"\bi\b", "I", out)
        out = re.sub(r"(^|[.!?]\s+)([a-z])", lambda m: m.group(1) + m.group(2).upper(), out)
        return out if re.search(r"[.!?)]$", out) else f"{out}."
    return text


def translation_label(language: str | None) -> str:
    return language_name(language)

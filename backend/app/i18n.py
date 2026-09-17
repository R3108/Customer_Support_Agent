"""Language detection and reply localization.

Retrieval, policies and the knowledge base stay in English; customers are answered in
their own language. The model writes localized replies directly; fixed system messages
(handoffs, action confirmations) are translated here. Offline mode can't translate, so
it replies in English with a short notice in the customer's language.
"""

from __future__ import annotations

import re

from langchain_core.messages import HumanMessage, SystemMessage
from pydantic import BaseModel, Field

from .config import get_settings
from .llm import structured_call

LANGUAGES: dict[str, str] = {
    "en": "English", "es": "Spanish", "fr": "French", "de": "German", "pt": "Portuguese", "it": "Italian",
    "nl": "Dutch", "hi": "Hindi", "ja": "Japanese", "zh": "Chinese", "ko": "Korean", "ar": "Arabic", "ru": "Russian",
}

# Common function words: distinctive enough to separate the Latin-script languages we support.
STOPWORDS: dict[str, set[str]] = {
    "en": set("the and is are my your you what where when how can could would please order i it this that with for have not".split()),
    "es": set("el la los las es mi mis tu pedido dónde donde cuándo cuando cómo como puedo quiero por para con una un que está hola gracias no".split()),
    "fr": set("le la les est mon ma mes votre commande où quand comment puis je veux pour avec une un que bonjour merci ne pas".split()),
    "de": set("der die das ist mein meine ihre bestellung wo wann wie kann ich möchte für mit ein eine nicht hallo danke und".split()),
    "pt": set("o a os as é meu minha meus seu pedido onde quando como posso quero para com uma um que olá obrigado não está".split()),
    "it": set("il lo la gli le è mio mia miei suo ordine dove quando come posso voglio per con una un che ciao grazie non".split()),
    "nl": set("de het is mijn uw bestelling waar wanneer hoe kan ik wil voor met een niet hallo dank".split()),
}
SCRIPTS: list[tuple[str, str]] = [
    ("hi", r"[ऀ-ॿ]"),
    ("ja", r"[぀-ヿ]"),
    ("ko", r"[가-힯]"),
    ("zh", r"[一-鿿]"),
    ("ar", r"[؀-ۿ]"),
    ("ru", r"[Ѐ-ӿ]"),
]

OFFLINE_NOTICE: dict[str, str] = {
    "es": "Por ahora solo puedo responder en inglés; un especialista puede ayudarte en español.",
    "fr": "Pour l'instant je ne peux répondre qu'en anglais ; un conseiller peut vous aider en français.",
    "de": "Ich kann derzeit nur auf Englisch antworten; ein Mitarbeiter hilft Ihnen gern auf Deutsch.",
    "pt": "No momento só posso responder em inglês; um especialista pode ajudar você em português.",
    "it": "Al momento posso rispondere solo in inglese; uno specialista può aiutarti in italiano.",
    "nl": "Ik kan op dit moment alleen in het Engels antwoorden; een medewerker helpt u graag in het Nederlands.",
}


def language_name(code: str | None) -> str:
    return LANGUAGES.get(code or "en", code or "English")


def detect_language(text: str, previous: str | None = None) -> str:
    """Best-effort detection. Short or ambiguous messages ("yes", an order number) keep the previous language."""
    for code, pattern in SCRIPTS:
        if len(re.findall(pattern, text)) >= 2:
            return code
    words = re.findall(r"[a-zà-ÿ]+", text.lower())
    scores = {code: sum(w in vocab for w in words) for code, vocab in STOPWORDS.items()}
    best, hits = max(scores.items(), key=lambda kv: kv[1])
    runner_up = sorted(scores.values())[-2]
    if hits >= 2 and hits > runner_up:
        return best
    return previous or "en"


def normalize(code: str | None) -> str | None:
    code = (code or "").strip().lower()[:2]
    return code if code in LANGUAGES else None


class Translation(BaseModel):
    text: str = Field(description="The translated message. Keep Markdown, emoji, order numbers, ticket ids, amounts and URLs unchanged.")


def translate(text: str, language: str) -> str | None:
    """Translate with the configured model; None when unavailable."""
    result = structured_call(
        Translation,
        [
            SystemMessage("You translate customer-support messages. Preserve meaning, tone, Markdown formatting and all identifiers exactly."),
            HumanMessage(f"Translate into {language_name(language)}:\n\n{text}"),
        ],
    )
    return result.text if result and result.text.strip() else None


def localize(text: str, language: str | None) -> str:
    """Return `text` in the customer's language (or English with a localized notice when offline)."""
    if not text or not language or language == "en" or not get_settings().multilingual_enabled:
        return text
    translated = translate(text, language)
    if translated:
        return translated
    notice = OFFLINE_NOTICE.get(language)
    return f"_{notice}_\n\n{text}" if notice else text

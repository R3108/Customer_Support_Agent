"""Intent taxonomy and the offline keyword classifier."""

from __future__ import annotations

import re
from dataclasses import dataclass

INTENTS: dict[str, dict] = {
    "order_status": {"label": "Order status & tracking", "kb_category": "shipping", "account": True},
    "shipping_info": {"label": "Shipping options & policy", "kb_category": "shipping", "account": False},
    "returns_refunds": {"label": "Returns, exchanges & refunds", "kb_category": "returns", "account": True},
    "cancel_modify_order": {"label": "Cancel or change an order", "kb_category": "orders", "account": True},
    "damaged_or_wrong_item": {"label": "Damaged, defective or wrong item", "kb_category": "returns", "account": True},
    "billing_payment": {"label": "Billing & payments", "kb_category": "billing", "account": True},
    "account_help": {"label": "Account & security", "kb_category": "account", "account": False},
    "membership_rewards": {"label": "Aurora+ & rewards", "kb_category": "account", "account": True},
    "product_question": {"label": "Products, sizing & warranty", "kb_category": "product", "account": False},
    "complaint": {"label": "Complaint / feedback", "kb_category": "support", "account": True},
    "human_handoff": {"label": "Asked for a human", "kb_category": "support", "account": True},
    "greeting": {"label": "Greeting / small talk", "kb_category": None, "account": False},
    "general_inquiry": {"label": "General inquiry", "kb_category": None, "account": False},
}

INTENT_NAMES = tuple(INTENTS)

KEYWORDS: dict[str, list[str]] = {
    "order_status": [
        "where is my order", "where's my order", "wheres my order", "track", "tracking", "order status", "status of my order",
        "shipped yet", "has it shipped", "arrive", "arriving", "delivery date", "hasn't arrived", "not arrived",
        "delayed", "late", "when will", "eta", "out for delivery", "still waiting", "lost package", "package",
        "where is my package", "delivered", "check on my order", "check my order",
    ],
    "shipping_info": [
        "shipping cost", "shipping options", "ship to", "international", "canada", "overnight", "expedited",
        "free shipping", "how long does shipping", "how long does delivery", "shipping time", "freight",
        "do you ship", "standard shipping", "shipping take",
    ],
    "returns_refunds": [
        "return", "refund", "exchange", "money back", "send it back", "send back", "rma", "doesn't fit",
        "does not fit", "too small", "too big", "price adjustment", "return policy", "return window",
    ],
    "cancel_modify_order": [
        "cancel", "cancel my order", "change my order", "modify", "change the address", "change address",
        "change my address", "remove an item", "add an item", "change the size", "wrong address",
    ],
    "damaged_or_wrong_item": [
        "damaged", "broken", "defective", "torn", "ripped", "cracked", "faulty", "wrong item", "missing item",
        "arrived damaged", "snapped", "leaking", "received the wrong",
    ],
    "billing_payment": [
        "charge", "charged", "billing", "payment", "invoice", "receipt", "promo", "coupon", "discount code",
        "klarna", "paypal", "gift card", "sales tax", "double charged", "charged twice", "credit card", "pay",
    ],
    "account_help": [
        "password", "login", "log in", "sign in", "can't access", "2fa", "two-factor", "two factor",
        "update my email", "delete my account", "hacked", "account settings", "locked out",
    ],
    "membership_rewards": [
        "aurora+", "aurora plus", "membership", "member", "rewards", "points", "renew", "auto-renew",
    ],
    "product_question": [
        "size", "sizing", "fit", "warranty", "tent", "sleeping bag", "jacket", "boots", "care", "wash",
        "temperature rating", "restock", "in stock", "recall", "backpack", "headlamp", "kayak", "clean",
    ],
    "complaint": [
        "terrible", "worst", "unacceptable", "ridiculous", "furious", "disappointed", "complaint",
        "bad experience", "feedback", "suggestion", "not happy",
    ],
    "human_handoff": [
        "human", "real person", "representative", "speak to someone", "talk to someone", "manager",
        "supervisor", "live agent", "talk to a person", "speak to a person",
    ],
    "greeting": ["hi", "hello", "hey", "good morning", "good afternoon", "good evening", "thanks", "thank you", "yo"],
}


# Core phrases in other languages so the offline engine still routes non-English customers.
MULTILINGUAL_KEYWORDS: dict[str, list[str]] = {
    "order_status": ["dónde está mi pedido", "mi pedido", "seguimiento", "où est ma commande", "ma commande", "suivi",
                     "wo ist meine bestellung", "meine bestellung", "sendungsverfolgung", "meu pedido", "rastreamento"],
    "returns_refunds": ["devolver", "devolución", "reembolso", "retourner", "remboursement", "rücksendung", "rückerstattung",
                        "zurückgeben", "devolução"],
    "cancel_modify_order": ["cancelar", "cancelar mi pedido", "annuler", "annuler ma commande", "stornieren", "bestellung stornieren"],
    "damaged_or_wrong_item": ["dañado", "roto", "endommagé", "cassé", "beschädigt", "kaputt", "danificado"],
    "billing_payment": ["cobro", "factura", "facture", "paiement", "rechnung", "zahlung", "cobrança"],
    "human_handoff": ["hablar con una persona", "agente humano", "parler à un humain", "mit einem menschen", "falar com uma pessoa"],
    "greeting": ["hola", "bonjour", "hallo", "olá", "gracias", "merci", "danke", "obrigado"],
}
for _intent, _phrases in MULTILINGUAL_KEYWORDS.items():
    KEYWORDS[_intent].extend(_phrases)


@dataclass
class IntentGuess:
    intent: str
    confidence: float
    scores: dict[str, float]


def classify_offline(text: str) -> IntentGuess:
    lowered = text.lower()
    scores: dict[str, float] = {}
    for intent, phrases in KEYWORDS.items():
        score = 0.0
        for phrase in phrases:
            if re.search(rf"(?<![a-z]){re.escape(phrase)}(?![a-z])", lowered):
                score += 1.0 + 0.5 * phrase.count(" ")  # multi-word phrases are more specific
        if score:
            scores[intent] = score

    # Greetings only win when the message is basically just a greeting.
    if "greeting" in scores and (len(lowered.split()) > 5 or len(scores) > 1):
        scores.pop("greeting")

    # An order number strongly implies an order-centric request.
    if re.search(r"\bord[-\s]?\d{5}\b", lowered) and not scores:
        scores["order_status"] = 1.5

    if not scores:
        return IntentGuess("general_inquiry", 0.35, {})

    ranked = sorted(scores.items(), key=lambda kv: -kv[1])
    top_intent, top = ranked[0]
    second = ranked[1][1] if len(ranked) > 1 else 0.0
    margin = (top - second) / top
    strength = min(top / 3.0, 1.0)
    confidence = round(min(0.97, 0.5 + 0.3 * margin + 0.2 * strength), 3)
    return IntentGuess(top_intent, confidence, scores)

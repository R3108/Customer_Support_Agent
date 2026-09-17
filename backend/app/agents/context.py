"""Account-context assembly with ownership and identity verification.

Order details are only exposed to the agents (and therefore the LLM) when the order
belongs to the signed-in customer, or when an anonymous visitor supplies the email
address on the order.
"""

from __future__ import annotations

from typing import Any

from .. import commerce

ACTIVE_STATUSES = {"processing", "shipped", "delayed", "out_for_delivery"}
CANDIDATE_STATUSES: dict[str, set[str]] = {
    "order_status": ACTIVE_STATUSES,
    "cancel_modify_order": {"processing"},
    "returns_refunds": {"delivered", "return_in_progress"},
    "damaged_or_wrong_item": {"delivered"},
}


def gather_account_context(state: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any]]:
    """Return (account_context, entity_updates)."""
    entities = state.get("entities") or {}
    intent = state.get("intent", "")
    customer = commerce.get_customer(state.get("customer_id"))
    ctx: dict[str, Any] = {"authenticated": customer is not None}
    entity_updates: dict[str, Any] = {}
    if customer:
        ctx["customer"] = commerce.customer_summary(customer)

    signals = state.get("signals") or {}
    mentioned = signals.get("mentioned_order_ids") or []
    order_id = mentioned[-1] if mentioned else None
    if not order_id and customer:
        # "the down jacket" -> the customer's order containing that product.
        order_id = match_order_by_product(customer["id"], signals.get("text", ""))
        if order_id:
            entity_updates.update(active_order_id=order_id, active_order_source="product", order_ids=[order_id])
    remembered = entities.get("active_order_id")
    if not order_id and remembered:
        remembered_order = commerce.get_order(remembered)
        wanted = CANDIDATE_STATUSES.get(intent)
        # Reuse the remembered order unless it clearly doesn't fit this request.
        if not (customer and wanted and remembered_order and remembered_order["status"] not in wanted
                and entities.get("active_order_source") == "auto"):
            order_id = remembered
    if order_id:
        order = commerce.get_order(order_id)
        if order is None:
            ctx["order_lookup"] = {"order_id": order_id, "result": "not_found"}
        elif customer:
            if order["customer_id"] == customer["id"]:
                ctx["order"] = commerce.order_summary(order, customer)
                ctx["order_lookup"] = {"order_id": order_id, "result": "found"}
            else:
                # Never confirm that someone else's order exists.
                ctx["order_lookup"] = {"order_id": order_id, "result": "not_found"}
        else:
            owner = commerce.get_customer(order["customer_id"])
            email = (entities.get("email") or "").lower()
            if owner and email and email == owner["email"].lower():
                ctx["order"] = commerce.order_summary(order, owner)
                ctx["order_lookup"] = {"order_id": order_id, "result": "found", "verified_via": "email"}
                ctx["verified_customer"] = {"first_name": owner["name"].split()[0], "tier": owner["tier"],
                                            "customer_id": owner["id"], "lifetime_value": owner["lifetime_value"]}
                entity_updates["verified_email"] = email
            else:
                ctx["order_lookup"] = {
                    "order_id": order_id,
                    "result": "verification_failed" if email else "verification_required",
                }
    elif customer and intent in CANDIDATE_STATUSES:
        candidates = [o for o in commerce.orders_for_customer(customer["id"]) if o["status"] in CANDIDATE_STATUSES[intent]]
        if len(candidates) == 1:
            ctx["order"] = commerce.order_summary(candidates[0], customer)
            ctx["order_lookup"] = {"order_id": candidates[0]["id"], "result": "found", "auto_selected": True}
            entity_updates["active_order_id"] = candidates[0]["id"]
            entity_updates["active_order_source"] = "auto"
            entity_updates["order_ids"] = [candidates[0]["id"]]
        elif candidates:
            ctx["candidate_orders"] = [
                {"order_id": o["id"], "placed_at": o["placed_at"], "status": o["status"],
                 "items": ", ".join(i["name"] for i in o["items"]), "total": o["total"]}
                for o in candidates[:4]
            ]
    return ctx, entity_updates


GENERIC_PRODUCT_TOKENS = {"aurora", "pair", "compact", "insulat", "10ft", "32oz", "300", "65l", "20f"}


def match_order_by_product(customer_id: str, text: str) -> str | None:
    from ..rag.retriever import tokenize

    words = set(tokenize(text)) - GENERIC_PRODUCT_TOKENS
    if not words:
        return None
    scored: list[tuple[int, str]] = []
    for order in commerce.orders_for_customer(customer_id):
        names = set(tokenize(" ".join(i["name"] for i in order["items"]))) - GENERIC_PRODUCT_TOKENS
        overlap = len(words & names)
        if overlap:
            scored.append((overlap, order["id"]))
    if not scored:
        return None
    scored.sort(key=lambda t: -t[0])
    if len(scored) > 1 and scored[0][0] == scored[1][0]:
        return None  # ambiguous: let the agent ask
    return scored[0][1]


def first_name(state: dict[str, Any]) -> str | None:
    ctx = state.get("account_context") or {}
    if ctx.get("customer"):
        return ctx["customer"]["name"].split()[0]
    if ctx.get("verified_customer"):
        return ctx["verified_customer"]["first_name"]
    customer = commerce.get_customer(state.get("customer_id"))
    return customer["name"].split()[0] if customer else None

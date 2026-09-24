"""Mock commerce backend: customers, orders and policy computations.

In production this module would call the store platform (Shopify, Salesforce Commerce,
an internal OMS...). Everything the agents know about an account flows through here,
including the ownership / verification checks.
"""

from __future__ import annotations

import json
from collections.abc import Iterator
from contextlib import contextmanager
from contextvars import ContextVar
from datetime import date
from functools import lru_cache
from typing import Any

from . import db
from .config import get_settings

TODAY = date(2026, 9, 15)  # mock data is generated relative to this date
FINAL_SALE_SKUS = {"GIFT-CARD"}

# Test Lab runs see pristine source orders and keep their changes in this private, in-memory overlay,
# so a test can cancel an order without touching the real one (and real changes can't break a test).
# A ContextVar is visible to every agent node of the run and to nothing else.
_sandbox_patches: ContextVar[dict[str, dict[str, Any]] | None] = ContextVar("relay_sandbox_orders", default=None)


@contextmanager
def sandboxed_orders() -> Iterator[None]:
    token = _sandbox_patches.set({})
    try:
        yield
    finally:
        _sandbox_patches.reset(token)


def in_sandbox() -> bool:
    return _sandbox_patches.get() is not None


def _patches() -> dict[str, dict[str, Any]]:
    overlay = _sandbox_patches.get()
    return overlay if overlay is not None else db.order_patches()


@lru_cache
def _load(name: str) -> list[dict[str, Any]]:
    path = get_settings().data_dir / f"{name}.json"
    return json.loads(path.read_text(encoding="utf-8"))


def _orders() -> list[dict[str, Any]]:
    """Source orders with changes made by actions (cancellations, returns, refunds) layered on top."""
    patches = _patches()
    return [{**o, **patches[o["id"]]} if o["id"] in patches else o for o in _load("orders")]


def update_order(order_id: str, **fields: Any) -> dict[str, Any]:
    patch = {**_patches().get(order_id, {}), **fields}
    overlay = _sandbox_patches.get()
    if overlay is not None:
        overlay[order_id] = patch
    else:
        db.save_order_patch(order_id, patch)
    return get_order(order_id)  # type: ignore[return-value]


def reset_order_state() -> None:
    """Restore every order to its source record (demo reset)."""
    db.execute("DELETE FROM order_state")


def list_customers() -> list[dict[str, Any]]:
    return _load("customers")


def get_customer(customer_id: str | None) -> dict[str, Any] | None:
    if not customer_id:
        return None
    return next((c for c in _load("customers") if c["id"] == customer_id), None)


def find_customer_by_email(email: str | None) -> dict[str, Any] | None:
    if not email:
        return None
    return next((c for c in _load("customers") if c["email"].lower() == email.lower()), None)


def get_order(order_id: str | None) -> dict[str, Any] | None:
    if not order_id:
        return None
    return next((o for o in _orders() if o["id"] == order_id.upper()), None)


def orders_for_customer(customer_id: str) -> list[dict[str, Any]]:
    orders = [o for o in _orders() if o["customer_id"] == customer_id]
    return sorted(orders, key=lambda o: o["placed_at"], reverse=True)


def _days_since(iso: str | None) -> int | None:
    return (TODAY - date.fromisoformat(iso)).days if iso else None


def return_eligibility(order: dict[str, Any], customer: dict[str, Any] | None) -> dict[str, Any]:
    s = get_settings()
    window = 90 if customer and customer.get("tier") == "Aurora+" else 60
    days = _days_since(order.get("delivered_at"))
    result: dict[str, Any] = {
        "window_days": window,
        "days_since_delivery": days,
        "refund_amount": order["total"],
        "requires_human_approval": order["total"] > s.refund_approval_limit,
        "return_fee": 0.0 if customer and customer.get("tier") == "Aurora+" else 5.95,
    }
    if order["status"] in ("canceled", "refunded"):
        result.update(eligible=False, reason=f"Order is already {order['status']}.")
    elif order["status"] == "return_in_progress":
        result.update(eligible=False, reason="A return is already in progress for this order.")
    elif days is None:
        result.update(eligible=False, reason="Order has not been delivered yet; it can be canceled or refused on delivery instead.")
    elif days > window:
        result.update(eligible=False, reason=f"Delivered {days} days ago, outside the {window}-day return window.", requires_human_approval=True)
    else:
        result.update(eligible=True, reason=f"Delivered {days} days ago, within the {window}-day return window ({window - days} days left).")
    return result


def shipment_health(order: dict[str, Any]) -> dict[str, Any]:
    eta = order.get("estimated_delivery")
    delta = _days_since(eta) if eta else None  # positive => past the ETA
    delayed = order["status"] == "delayed" or (
        order["status"] == "shipped" and delta is not None and delta > 3
    )
    last_event = order["events"][-1] if order.get("events") else None
    stale_days = _days_since(last_event["date"]) if last_event else None
    return {
        "is_delayed": delayed,
        "days_past_eta": max(delta, 0) if delta is not None else 0,
        "days_until_eta": max(-delta, 0) if delta is not None else 0,
        "days_since_last_update": stale_days,
        "needs_carrier_trace": bool(delayed and (stale_days or 0) >= 5),
    }


def order_summary(order: dict[str, Any], customer: dict[str, Any] | None = None) -> dict[str, Any]:
    """Compact, LLM-friendly view of an order with derived policy facts."""
    return {
        "order_id": order["id"],
        "placed_at": order["placed_at"],
        "status": order["status"],
        "items": [f"{i['qty']}× {i['name']} (${i['unit_price']:.2f})" for i in order["items"]],
        "total": order["total"],
        "payment_method": order["payment_method"],
        "shipping_method": order["shipping_method"],
        "carrier": order.get("carrier"),
        "tracking_number": order.get("tracking_number"),
        "shipped_at": order.get("shipped_at"),
        "estimated_delivery": order.get("estimated_delivery"),
        "delivered_at": order.get("delivered_at"),
        "tracking_events": order.get("events", []),
        "return": order.get("return"),
        "refund": order.get("refund"),
        "can_cancel": order["status"] == "processing",
        "can_change_address": order["status"] == "processing",
        "shipment_health": shipment_health(order),
        "return_eligibility": return_eligibility(order, customer),
    }


def customer_summary(customer: dict[str, Any]) -> dict[str, Any]:
    return {
        "customer_id": customer["id"],
        "name": customer["name"],
        "email": customer["email"],
        "tier": customer["tier"],
        "member_since": customer["member_since"],
        "membership_renews": customer.get("membership_renews"),
        "rewards_points": customer["rewards_points"],
        "two_factor_enabled": customer["two_factor_enabled"],
        "recent_orders": [
            {"order_id": o["id"], "placed_at": o["placed_at"], "status": o["status"], "total": o["total"],
             "items": ", ".join(i["name"] for i in o["items"])}
            for o in orders_for_customer(customer["id"])[:5]
        ],
    }

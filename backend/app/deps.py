"""Shared FastAPI dependencies."""

from __future__ import annotations

from fastapi import Header, HTTPException

from .config import get_settings


def require_admin(x_admin_key: str | None = Header(default=None)) -> None:
    key = get_settings().admin_api_key
    if key and x_admin_key != key:
        raise HTTPException(status_code=401, detail="Invalid or missing X-Admin-Key")

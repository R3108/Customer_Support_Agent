"""Shared FastAPI dependencies: who is calling, and are they allowed to."""

from __future__ import annotations

import hmac

from fastapi import Depends, HTTPException, Request

from . import auth, observability
from .auth import Principal
from .config import get_settings

# Cookie-authenticated writes must carry this header. Browsers only let a page add custom headers to a
# cross-origin request after a CORS preflight, which our CORS allow-list rejects for foreign sites,
# so a malicious page can't make a signed-in agent's browser change anything (CSRF).
CSRF_HEADER = "X-Relay-CSRF"
SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}


def current_principal(request: Request) -> Principal:
    principal = _authenticate(request)
    # Recorded for the access log and the audit trail of this request.
    if ctx := observability.current():
        ctx.actor = principal.user["email"] if principal.user else principal.kind
        ctx.actor_kind = principal.kind
    return principal


def _authenticate(request: Request) -> Principal:
    settings = get_settings()

    # 1. API key: for scripts, CI and integrations. Compared in constant time.
    key = request.headers.get("x-admin-key")
    if settings.admin_api_key and key and hmac.compare_digest(key.encode(), settings.admin_api_key.encode()):
        return Principal(kind="api_key", role="admin")

    # 2. Google sign-in session cookie.
    token = request.cookies.get(settings.session_cookie_name)
    if settings.auth_enabled and token:
        user = auth.session_user(token)
        if user:
            if request.method not in SAFE_METHODS and request.headers.get(CSRF_HEADER) != "1":
                raise HTTPException(403, "Missing CSRF header")
            return Principal(kind="user", role=user["role"], user=user)

    # 3. Nothing configured: local development, everything open (the original behaviour).
    if not settings.auth_enabled and not settings.admin_api_key:
        return Principal(kind="open", role="admin")

    raise HTTPException(401, "Sign in required" if settings.auth_enabled else "Invalid or missing X-Admin-Key")


def require_agent(principal: Principal = Depends(current_principal)) -> Principal:
    """Any console user: agents and admins."""
    return principal


def require_admin(principal: Principal = Depends(current_principal)) -> Principal:
    """Workspace configuration and team management."""
    if not principal.is_admin:
        raise HTTPException(403, "Only admins can do this")
    return principal

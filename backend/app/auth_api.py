"""Sign-in, session and team-management endpoints."""

from __future__ import annotations

import base64
import hmac
import json
import secrets
from typing import Any, Literal
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, Field

from . import audit, auth
from .auth import AuthError, Principal
from .config import get_settings
from .deps import current_principal, require_admin

router = APIRouter()


class GoogleCredential(BaseModel):
    credential: str = Field(min_length=20, max_length=8000)


class Invite(BaseModel):
    email: str = Field(pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$", max_length=254)
    role: Literal["admin", "agent"] = "agent"


class UserPatch(BaseModel):
    role: Literal["admin", "agent"] | None = None
    status: Literal["active", "disabled"] | None = None


def _mode() -> str:
    settings = get_settings()
    return "google" if settings.auth_enabled else "api_key" if settings.admin_api_key else "open"


def _public_user(principal: Principal) -> dict[str, Any] | None:
    if not principal.user:
        return None
    u = principal.user
    return {"id": u["id"], "email": u["email"], "name": principal.display_name, "picture": u.get("picture"), "role": u["role"]}


def _http(exc: AuthError) -> HTTPException:
    return HTTPException(exc.status, exc.message)


def _audit_sign_in(method: str, user: dict[str, Any] | None = None, error: AuthError | None = None) -> None:
    if user:
        audit.record("auth.sign_in", "user", user["id"], {"method": method}, actor=user["email"], actor_kind="user")
    else:
        audit.record("auth.sign_in_failed", None, None, {"method": method, "reason": error.message if error else None},
                     actor="anonymous", actor_kind="anonymous")


@router.get("/api/auth/config")
def auth_config() -> dict[str, Any]:
    settings = get_settings()
    return {"mode": _mode(), "google_client_id": settings.google_client_id}


@router.get("/api/auth/me")
def me(request: Request) -> dict[str, Any]:
    """Who the console is signed in as. 200 with user=null when signed out, so the UI can show the login screen."""
    try:
        principal = current_principal(request)
    except HTTPException:
        return {"mode": _mode(), "user": None, "role": None}
    return {"mode": _mode(), "user": _public_user(principal), "role": principal.role}


def _set_session_cookie(response: Response, token: str) -> None:
    settings = get_settings()
    response.set_cookie(
        settings.session_cookie_name,
        token,
        max_age=settings.session_ttl_hours * 3600,
        httponly=True,  # unreadable from JavaScript, so XSS can't steal it
        secure=settings.session_cookie_secure,
        samesite=settings.session_cookie_samesite,  # type: ignore[arg-type]
        path="/",
    )


@router.post("/api/auth/google")
async def google_sign_in(body: GoogleCredential, request: Request, response: Response) -> dict[str, Any]:
    settings = get_settings()
    if not settings.auth_enabled:
        raise HTTPException(404, "Google sign-in isn't enabled on this server")
    try:
        # Verification fetches Google's signing certificates, so keep it off the event loop.
        claims = await run_in_threadpool(auth.verify_google_token, body.credential)
        user, token = await run_in_threadpool(auth.sign_in, claims, request.headers.get("user-agent"))
    except AuthError as exc:
        await run_in_threadpool(_audit_sign_in, "google_credential", None, exc)
        raise _http(exc) from exc
    await run_in_threadpool(_audit_sign_in, "google_credential", user)
    _set_session_cookie(response, token)
    principal = Principal(kind="user", role=user["role"], user=user)
    return {"mode": "google", "user": _public_user(principal), "role": user["role"]}


# ---------------------------------------------------------------- OAuth redirect flow (client ID + secret)
OAUTH_COOKIE = "relay_oauth"
OAUTH_COOKIE_PATH = "/api/auth/google"


def _redirect_uri(request: Request) -> str:
    return get_settings().google_redirect_uri or str(request.url_for("google_callback"))


def _safe_return_to(return_to: str | None) -> str:
    """Only send the browser back to a console origin we trust (the CORS allow-list), never an arbitrary site."""
    origins = get_settings().cors_origin_list
    fallback = origins[0] + "/" if origins else "/"
    if not return_to:
        return fallback
    parts = urlsplit(return_to)
    origin = f"{parts.scheme}://{parts.netloc}"
    return return_to if origin in origins else fallback


def _with_error(url: str, message: str) -> str:
    parts = urlsplit(url)
    query = urlencode([*parse_qsl(parts.query), ("auth_error", message)])
    return urlunsplit((parts.scheme, parts.netloc, parts.path, query, ""))


@router.get("/api/auth/google/login")
def google_login(request: Request, return_to: str | None = None) -> RedirectResponse:
    settings = get_settings()
    back = _safe_return_to(return_to)
    if not settings.auth_enabled or not settings.google_client_secret:
        return RedirectResponse(_with_error(back, "Google sign-in isn't configured on this server (client ID and secret required)."), 302)
    state = secrets.token_urlsafe(24)
    verifier, challenge = auth.pkce_pair()
    response = RedirectResponse(auth.google_auth_url(state, challenge, _redirect_uri(request)), 302)
    # Short-lived, HttpOnly: binds Google's callback to this browser (CSRF) and carries the PKCE verifier.
    response.set_cookie(
        OAUTH_COOKIE, base64.urlsafe_b64encode(json.dumps({"state": state, "verifier": verifier, "return_to": back}).encode()).decode(),
        max_age=600, httponly=True, secure=settings.session_cookie_secure, samesite="lax", path=OAUTH_COOKIE_PATH,
    )
    return response


@router.get("/api/auth/google/callback", name="google_callback")
async def google_callback(
    request: Request, code: str | None = None, state: str | None = None, error: str | None = None
) -> RedirectResponse:
    settings = get_settings()
    try:
        saved = json.loads(base64.urlsafe_b64decode(request.cookies.get(OAUTH_COOKIE) or "e30="))  # e30= is "{}"
    except ValueError:  # includes binascii.Error and JSONDecodeError
        saved = {}
    if not isinstance(saved, dict):
        saved = {}
    back = _safe_return_to(saved.get("return_to"))

    def fail(message: str) -> RedirectResponse:
        response = RedirectResponse(_with_error(back, message), 302)
        response.delete_cookie(OAUTH_COOKIE, path=OAUTH_COOKIE_PATH)
        return response

    if error:
        return fail("Google sign-in was cancelled." if error == "access_denied" else "Google sign-in failed. Please try again.")
    if not settings.auth_enabled or not settings.google_client_secret:
        return fail("Google sign-in isn't configured on this server.")
    if not code or not state or not saved.get("state") or not hmac.compare_digest(state, str(saved["state"])):
        return fail("Your sign-in session expired. Please try again.")
    try:
        claims = await run_in_threadpool(auth.exchange_google_code, code, str(saved.get("verifier", "")), _redirect_uri(request))
        user, token = await run_in_threadpool(auth.sign_in, claims, request.headers.get("user-agent"))
    except AuthError as exc:
        await run_in_threadpool(_audit_sign_in, "google_oauth", None, exc)
        return fail(exc.message)
    await run_in_threadpool(_audit_sign_in, "google_oauth", user)
    response = RedirectResponse(back, 302)
    response.delete_cookie(OAUTH_COOKIE, path=OAUTH_COOKIE_PATH)
    _set_session_cookie(response, token)
    return response


@router.post("/api/auth/logout")
def logout(request: Request, response: Response) -> dict[str, bool]:
    settings = get_settings()
    token = request.cookies.get(settings.session_cookie_name)
    if token:
        if user := auth.session_user(token):
            audit.record("auth.sign_out", "user", user["id"], actor=user["email"], actor_kind="user")
        auth.sign_out(token)
    response.delete_cookie(settings.session_cookie_name, path="/", secure=settings.session_cookie_secure, samesite=settings.session_cookie_samesite)  # type: ignore[arg-type]
    return {"ok": True}


# ---------------------------------------------------------------- team (admins)
@router.get("/api/admin/users", dependencies=[Depends(require_admin)])
def list_users() -> list[dict[str, Any]]:
    return auth.list_users()


@router.post("/api/admin/users")
def invite_user(body: Invite, principal: Principal = Depends(require_admin)) -> dict[str, Any]:
    try:
        user = auth.invite_user(str(body.email), body.role, principal.display_name or "API key")
    except AuthError as exc:
        raise _http(exc) from exc
    audit.record("user.invite", "user", user["id"], {"email": user["email"], "role": body.role})
    return user


@router.patch("/api/admin/users/{user_id}")
def update_user(user_id: str, body: UserPatch, principal: Principal = Depends(require_admin)) -> dict[str, Any]:
    before = auth.get_user(user_id)
    try:
        user = auth.update_user(user_id, principal, role=body.role, status=body.status)
    except AuthError as exc:
        raise _http(exc) from exc
    changes = {k: {"from": before[k], "to": user[k]} for k in ("role", "status") if before and before[k] != user[k]}
    if changes:
        audit.record("user.update", "user", user_id, {"email": user["email"], "changes": changes})
    return user


@router.delete("/api/admin/users/{user_id}")
def delete_user(user_id: str, principal: Principal = Depends(require_admin)) -> dict[str, bool]:
    before = auth.get_user(user_id)
    try:
        auth.delete_user(user_id, principal)
    except AuthError as exc:
        raise _http(exc) from exc
    audit.record("user.delete", "user", user_id, {"email": before["email"] if before else None})
    return {"ok": True}

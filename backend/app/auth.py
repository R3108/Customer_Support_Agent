"""Console authentication: Sign in with Google, server-side sessions and admin/agent roles.

Flow (OAuth 2.0 authorization code + PKCE): the console sends the browser to /api/auth/google/login,
which redirects to Google. Google redirects back to /api/auth/google/callback with a code, which we
exchange (with the client secret) for an ID token. We verify its signature, audience and issuer with
Google's official library, decide whether the account may join, and issue an opaque session token in
an HttpOnly cookie.
Only the SHA-256 of that token is stored, so a leaked database can't be replayed as sessions.

Who may sign in:
* anyone an admin invited from Settings → Team (with the role chosen there),
* emails in RELAY_AUTH_ADMIN_EMAILS (always admins — this is how the first admin gets in),
* anyone with a verified address on a domain in RELAY_AUTH_ALLOWED_DOMAINS (joins as an agent).
"""

from __future__ import annotations

import base64
import hashlib
import secrets
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any, Literal
from urllib.parse import urlencode

import httpx

from . import db
from .config import get_settings

Role = Literal["admin", "agent"]
ROLES: tuple[Role, ...] = ("admin", "agent")
USER_FIELDS = "id, email, name, picture, role, status, invited_by, created_at, last_login_at"


class AuthError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status
        self.message = message


@dataclass(frozen=True)
class Principal:
    """Who is making a console request."""

    kind: Literal["user", "api_key", "open"]  # open = no auth configured (local development)
    role: Role
    user: dict[str, Any] | None = field(default=None, compare=False)

    @property
    def is_admin(self) -> bool:
        return self.role == "admin"

    @property
    def display_name(self) -> str | None:
        if not self.user:
            return None
        return self.user.get("name") or self.user["email"].split("@")[0]


def actor_name(principal: Principal, claimed: str | None, fallback: str = "Support Specialist") -> str:
    """Name recorded on replies and decisions. Signed-in users can't act under someone else's name."""
    return principal.display_name or (claimed or "").strip() or fallback


# ---------------------------------------------------------------- Google
def verify_google_token(credential: str) -> dict[str, Any]:
    """Validate a Google ID token (signature, expiry, audience, issuer) and return its claims."""
    from google.auth.transport import requests as google_requests
    from google.oauth2 import id_token

    settings = get_settings()
    try:
        return id_token.verify_oauth2_token(credential, google_requests.Request(), settings.google_client_id, clock_skew_in_seconds=10)
    except ValueError as exc:  # bad signature, wrong audience, expired, malformed
        raise AuthError(401, "Google sign-in failed. Please try again.") from exc


GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"


def pkce_pair() -> tuple[str, str]:
    """A PKCE (verifier, S256 challenge) pair."""
    verifier = secrets.token_urlsafe(48)
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    return verifier, challenge


def google_auth_url(state: str, code_challenge: str, redirect_uri: str) -> str:
    settings = get_settings()
    return GOOGLE_AUTH_URL + "?" + urlencode({
        "client_id": settings.google_client_id,
        "redirect_uri": redirect_uri,
        "response_type": "code",
        "scope": "openid email profile",
        "state": state,
        "code_challenge": code_challenge,
        "code_challenge_method": "S256",
        "prompt": "select_account",
    })


def exchange_google_code(code: str, code_verifier: str, redirect_uri: str) -> dict[str, Any]:
    """Trade an authorization code for tokens (authenticated with the client secret) and return the verified ID token claims."""
    settings = get_settings()
    try:
        res = httpx.post(GOOGLE_TOKEN_URL, timeout=15, data={
            "code": code,
            "client_id": settings.google_client_id,
            "client_secret": settings.google_client_secret,
            "redirect_uri": redirect_uri,
            "grant_type": "authorization_code",
            "code_verifier": code_verifier,
        })
    except httpx.HTTPError as exc:
        raise AuthError(502, "Couldn't reach Google. Please try again.") from exc
    if res.status_code != 200 or "id_token" not in res.json():
        raise AuthError(401, "Google sign-in failed. Please try again.")
    return verify_google_token(res.json()["id_token"])


def _hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(dt: datetime) -> str:
    return dt.isoformat(timespec="seconds")


def sign_in(claims: dict[str, Any], user_agent: str | None = None) -> tuple[dict[str, Any], str]:
    """Admit (or reject) a verified Google account and open a session. Returns (user, raw session token)."""
    settings = get_settings()
    email = str(claims.get("email", "")).strip().lower()
    if not email or not claims.get("email_verified"):
        raise AuthError(403, "Your Google account's email address isn't verified.")
    sub = str(claims.get("sub", ""))
    name = claims.get("name") or claims.get("given_name")
    picture = claims.get("picture")
    domain = email.rsplit("@", 1)[-1]
    is_config_admin = email in settings.admin_email_set

    user = get_user_by_email(email)
    ts = db.now_iso()
    if user:
        if user["status"] == "disabled":
            raise AuthError(403, "Your access to this workspace has been removed. Ask an admin to restore it.")
        if user.get("google_sub") and user["google_sub"] != sub:
            # Same address, different Google account (e.g. a recycled Workspace mailbox): don't hand over the old identity.
            raise AuthError(403, "This email is linked to a different Google account. Ask an admin to re-invite you.")
        fields: dict[str, Any] = {"name": name or user["name"], "picture": picture, "google_sub": sub, "status": "active", "last_login_at": ts}
        if is_config_admin:
            fields["role"] = "admin"
        db.update_row("users", user["id"], **fields)
    elif is_config_admin or domain in settings.allowed_domain_set:
        db.insert("users", {
            "id": f"usr_{uuid.uuid4().hex[:12]}", "email": email, "name": name, "picture": picture,
            "role": "admin" if is_config_admin else "agent", "status": "active", "google_sub": sub,
            "invited_by": None, "created_at": ts, "last_login_at": ts,
        })
    else:
        raise AuthError(403, f"{email} hasn't been invited to this workspace. Ask an admin to invite you.")

    user = get_user_by_email(email)
    assert user is not None
    token = secrets.token_urlsafe(32)
    db.insert("sessions", {
        "id": _hash(token), "user_id": user["id"], "user_agent": (user_agent or "")[:300],
        "created_at": ts, "expires_at": _iso(_now() + timedelta(hours=settings.session_ttl_hours)),
    })
    _purge_expired()
    return user, token


def session_user(token: str) -> dict[str, Any] | None:
    """The active user behind a session cookie, or None if it's unknown, expired or the user was disabled."""
    rows = db.query(
        f"SELECT {', '.join('u.' + f.strip() for f in USER_FIELDS.split(','))} FROM sessions s JOIN users u ON u.id = s.user_id "
        "WHERE s.id = ? AND s.expires_at > ? AND u.status = 'active'",
        (_hash(token), _iso(_now())),
    )
    return rows[0] if rows else None


def sign_out(token: str) -> None:
    db.execute("DELETE FROM sessions WHERE id = ?", (_hash(token),))


def _purge_expired() -> None:
    db.execute("DELETE FROM sessions WHERE expires_at <= ?", (_iso(_now()),))


# ---------------------------------------------------------------- team management
def get_user_by_email(email: str) -> dict[str, Any] | None:
    rows = db.query("SELECT * FROM users WHERE email = ?", (email.strip().lower(),))
    return rows[0] if rows else None


def list_users() -> list[dict[str, Any]]:
    return db.query(f"SELECT {USER_FIELDS} FROM users ORDER BY status = 'disabled', role, COALESCE(name, email)")


def get_user(user_id: str) -> dict[str, Any] | None:
    rows = db.query(f"SELECT {USER_FIELDS} FROM users WHERE id = ?", (user_id,))
    return rows[0] if rows else None


def invite_user(email: str, role: Role, invited_by: str | None) -> dict[str, Any]:
    email = email.strip().lower()
    if get_user_by_email(email):
        raise AuthError(409, f"{email} is already on the team.")
    user_id = f"usr_{uuid.uuid4().hex[:12]}"
    db.insert("users", {
        "id": user_id, "email": email, "name": None, "picture": None, "role": role, "status": "invited",
        "google_sub": None, "invited_by": invited_by, "created_at": db.now_iso(), "last_login_at": None,
    })
    return get_user(user_id)  # type: ignore[return-value]


def _active_admins() -> int:
    return db.query("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND status = 'active'")[0]["n"]


def update_user(user_id: str, actor: Principal, role: Role | None = None, status: Literal["active", "disabled"] | None = None) -> dict[str, Any]:
    user = get_user(user_id)
    if not user:
        raise AuthError(404, "User not found")
    self_edit = actor.user is not None and actor.user["id"] == user_id
    losing_admin = user["role"] == "admin" and user["status"] == "active" and (role == "agent" or status == "disabled")
    if self_edit and losing_admin:
        raise AuthError(400, "You can't remove your own admin access. Ask another admin.")
    if losing_admin and _active_admins() <= 1:
        raise AuthError(400, "The workspace needs at least one active admin.")
    fields: dict[str, Any] = {}
    if role:
        fields["role"] = role
    if status:
        # Invited users stay "invited" until they first sign in.
        fields["status"] = "invited" if status == "active" and not user["last_login_at"] else status
    db.update_row("users", user_id, **fields)
    if status == "disabled":
        db.execute("DELETE FROM sessions WHERE user_id = ?", (user_id,))  # sign them out everywhere, immediately
    return get_user(user_id)  # type: ignore[return-value]


def delete_user(user_id: str, actor: Principal) -> None:
    user = get_user(user_id)
    if not user:
        raise AuthError(404, "User not found")
    if actor.user is not None and actor.user["id"] == user_id:
        raise AuthError(400, "You can't remove yourself.")
    if user["role"] == "admin" and user["status"] == "active" and _active_admins() <= 1:
        raise AuthError(400, "The workspace needs at least one active admin.")
    db.execute("DELETE FROM sessions WHERE user_id = ?", (user_id,))
    db.execute("DELETE FROM users WHERE id = ?", (user_id,))

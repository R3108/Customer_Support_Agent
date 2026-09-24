"""Google sign-in, sessions, roles, CSRF protection and the live change feed."""

import asyncio
import threading
import uuid
from urllib.parse import parse_qsl, urlsplit

import pytest
from fastapi.testclient import TestClient

from app import auth, db, events
from app.config import get_settings

CSRF = {"X-Relay-CSRF": "1"}


@pytest.fixture
def google(client, monkeypatch):
    """Turn Google sign-in on and fake Google's token verification: the credential string encodes the claims."""
    settings = get_settings()
    monkeypatch.setattr(settings, "google_client_id", "test-client.apps.googleusercontent.com")
    monkeypatch.setattr(settings, "auth_admin_emails", "boss@example.com")
    monkeypatch.setattr(settings, "auth_allowed_domains", "aurora.test")

    def fake_verify(credential: str):
        if credential.startswith("bad"):
            raise auth.AuthError(401, "Google sign-in failed. Please try again.")
        email, _, rest = credential.strip().partition("|")
        verified, _, sub = rest.partition("|")
        return {"email": email, "email_verified": verified != "unverified", "sub": sub or f"sub-{email}", "name": email.split("@")[0].title()}

    monkeypatch.setattr(auth, "verify_google_token", fake_verify)

    from app.main import app

    def browser():
        return TestClient(app)  # its own cookie jar, like a separate browser

    return browser


def login(browser, email, sub=""):
    # Credentials must be ≥20 chars; the fake verifier strips the padding.
    return browser.post("/api/auth/google", json={"credential": f"{email}||{sub}".ljust(20)})


def unique(domain="aurora.test"):
    return f"user-{uuid.uuid4().hex[:6]}@{domain}"


def test_open_mode_keeps_local_development_frictionless(client):
    me = client.get("/api/auth/me").json()
    assert me["mode"] == "open" and me["role"] == "admin" and me["user"] is None
    assert client.get("/api/admin/tickets").status_code == 200


def test_console_requires_sign_in_when_google_is_configured(google):
    b = google()
    assert b.get("/api/admin/tickets").status_code == 401
    assert b.get("/api/auth/me").json() == {"mode": "google", "user": None, "role": None}
    assert b.get("/api/auth/config").json()["google_client_id"] == "test-client.apps.googleusercontent.com"
    # The customer-facing chat stays public.
    assert b.get("/api/config").status_code == 200


def test_configured_admin_signs_in_and_gets_an_httponly_session(google):
    b = google()
    res = login(b, "boss@example.com")
    assert res.status_code == 200, res.text
    assert res.json()["user"]["role"] == "admin"
    cookie = res.headers["set-cookie"].lower()
    assert "httponly" in cookie and "samesite=lax" in cookie
    assert b.get("/api/admin/tickets").status_code == 200
    assert b.get("/api/auth/me").json()["user"]["email"] == "boss@example.com"
    # Only the hash of the token is stored.
    raw = b.cookies.get(get_settings().session_cookie_name)
    assert raw and not db.query("SELECT 1 FROM sessions WHERE id = ?", (raw,))


def test_uninvited_unverified_and_invalid_tokens_are_rejected(google):
    b = google()
    assert login(b, unique("gmail.com")).status_code == 403
    assert b.post("/api/auth/google", json={"credential": f"{unique()}|unverified|".ljust(20)}).status_code == 403
    assert b.post("/api/auth/google", json={"credential": "bad-token-xxxxxxxxxxxxxxxx"}).status_code == 401
    assert b.get("/api/admin/tickets").status_code == 401


def test_oauth_redirect_flow_uses_client_secret_and_state(google, monkeypatch):
    settings = get_settings()
    monkeypatch.setattr(settings, "google_client_secret", "shh")
    monkeypatch.setattr(settings, "cors_origins", "http://localhost:3000")
    exchanged = {}

    def fake_exchange(code, verifier, redirect_uri):
        exchanged.update(code=code, verifier=verifier, redirect_uri=redirect_uri)
        return auth.verify_google_token(code.ljust(20))  # the fake verifier decodes the claims from the code

    monkeypatch.setattr(auth, "exchange_google_code", fake_exchange)
    b = google()

    start = b.get("/api/auth/google/login", params={"return_to": "http://localhost:3000/tickets"}, follow_redirects=False)
    assert start.status_code == 302
    location = start.headers["location"]
    assert location.startswith(auth.GOOGLE_AUTH_URL) and "client_id=test-client" in location and "code_challenge=" in location
    assert "shh" not in location  # the secret never reaches the browser
    state = dict(parse_qsl(urlsplit(location).query))["state"]

    # A forged state (CSRF) is refused and nothing is exchanged.
    bad = b.get("/api/auth/google/callback", params={"code": "boss@example.com", "state": "forged"}, follow_redirects=False)
    assert bad.status_code == 302 and "auth_error=" in bad.headers["location"] and not exchanged

    start = b.get("/api/auth/google/login", params={"return_to": "http://localhost:3000/tickets"}, follow_redirects=False)
    state = dict(parse_qsl(urlsplit(start.headers["location"]).query))["state"]
    done = b.get("/api/auth/google/callback", params={"code": "boss@example.com", "state": state}, follow_redirects=False)
    assert done.status_code == 302 and done.headers["location"] == "http://localhost:3000/tickets"
    assert exchanged["verifier"] and exchanged["redirect_uri"].endswith("/api/auth/google/callback")
    assert b.get("/api/auth/me").json()["user"]["email"] == "boss@example.com"


def test_oauth_login_never_redirects_to_foreign_sites(google, monkeypatch):
    settings = get_settings()
    monkeypatch.setattr(settings, "cors_origins", "http://localhost:3000")
    b = google()
    # No secret configured: bounce straight back to the console with an explanation.
    res = b.get("/api/auth/google/login", params={"return_to": "https://evil.example/phish"}, follow_redirects=False)
    assert res.headers["location"].startswith("http://localhost:3000/?auth_error=")


def test_writes_with_a_session_need_the_csrf_header(google):
    b = google()
    login(b, "boss@example.com")
    assert b.patch("/api/admin/settings", json={"company_name": "Aurora Outfitters"}).status_code == 403
    assert b.patch("/api/admin/settings", json={"company_name": "Aurora Outfitters"}, headers=CSRF).status_code == 200


def test_agents_work_tickets_but_cannot_change_workspace_config(google, chat):
    b = google()
    email = unique()
    assert login(b, email).json()["user"]["role"] == "agent"  # allowed domain → agent
    assert b.get("/api/admin/tickets").status_code == 200
    assert b.get("/api/admin/settings").status_code == 403
    assert b.post("/api/admin/macros", json={"title": "x", "body": "y"}, headers=CSRF).status_code == 403
    assert b.get("/api/admin/users").status_code == 403

    # Replies are recorded under the signed-in identity, whatever name the client claims.
    convo = chat("CUST-002")
    ticket_id = convo.send("I want to speak to a human")["message"]["meta"]["ticket_id"]
    res = b.post(f"/api/admin/tickets/{ticket_id}/reply", json={"content": "On it!", "agent_name": "Someone Else"}, headers=CSRF)
    assert res.status_code == 200, res.text
    expected = email.split("@")[0].title()
    assert res.json()["message"]["meta"]["agent_name"] == expected
    assert res.json()["ticket"]["assignee"] == expected


def test_invites_roles_and_revocation(google):
    admin, invitee = google(), google()
    login(admin, "boss@example.com")
    email = unique("gmail.com")  # outside the allowed domain: needs an invite

    assert login(invitee, email).status_code == 403
    created = admin.post("/api/admin/users", json={"email": email.upper(), "role": "agent"}, headers=CSRF)
    assert created.status_code == 200 and created.json()["status"] == "invited" and created.json()["email"] == email
    assert admin.post("/api/admin/users", json={"email": email, "role": "agent"}, headers=CSRF).status_code == 409

    assert login(invitee, email).status_code == 200
    assert invitee.get("/api/admin/tickets").status_code == 200

    # Promote, then disable: the open session dies immediately.
    user_id = created.json()["id"]
    assert admin.patch(f"/api/admin/users/{user_id}", json={"role": "admin"}, headers=CSRF).json()["role"] == "admin"
    assert invitee.get("/api/admin/settings").status_code == 200
    assert admin.patch(f"/api/admin/users/{user_id}", json={"status": "disabled"}, headers=CSRF).status_code == 200
    assert invitee.get("/api/admin/tickets").status_code == 401
    assert login(invitee, email).status_code == 403


def test_admins_cannot_lock_the_workspace_out(google):
    b = google()
    login(b, "boss@example.com")
    me = b.get("/api/auth/me").json()["user"]
    assert b.patch(f"/api/admin/users/{me['id']}", json={"role": "agent"}, headers=CSRF).status_code == 400
    assert b.delete(f"/api/admin/users/{me['id']}", headers=CSRF).status_code == 400


def test_email_bound_to_a_different_google_account_is_refused(google):
    b = google()
    email = unique()
    assert login(b, email, sub="original-sub").status_code == 200
    assert login(google(), email, sub="someone-else").status_code == 403


def test_logout_ends_the_session(google):
    b = google()
    login(b, unique())
    assert b.get("/api/admin/tickets").status_code == 200
    assert b.post("/api/auth/logout", headers=CSRF).status_code == 200
    assert b.get("/api/admin/tickets").status_code == 401


def test_api_key_still_works_for_integrations(google, monkeypatch):
    monkeypatch.setattr(get_settings(), "admin_api_key", "s3cret-key")
    b = google()
    assert b.get("/api/admin/tickets", headers={"X-Admin-Key": "wrong"}).status_code == 401
    assert b.get("/api/admin/tickets", headers={"X-Admin-Key": "s3cret-key"}).status_code == 200


def test_writes_from_worker_threads_reach_live_subscribers(client):
    async def scenario():
        feed = events.subscribe(batch_window=0.05, keepalive=5)
        first = asyncio.ensure_future(feed.__anext__())
        await asyncio.sleep(0.05)  # let the subscription register
        assert events.subscriber_count() >= 1

        def write():  # FastAPI runs sync endpoints on threads, so publish must hop loops safely
            ts = db.now_iso()
            db.insert("macros", {"id": f"mac_{uuid.uuid4().hex[:8]}", "title": "t", "body": "b", "created_at": ts, "updated_at": ts})
            db.execute("UPDATE tickets SET updated_at = updated_at WHERE 0")
            db.execute("DELETE FROM order_state WHERE 0")  # not a broadcast topic

        threading.Thread(target=write).start()
        topics = await asyncio.wait_for(first, timeout=2)
        await feed.aclose()
        return topics

    assert asyncio.run(scenario()) == {"macros", "tickets"}
    assert events.subscriber_count() == 0

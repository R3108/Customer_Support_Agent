"""Admin API for workspace settings, approvals, copilot, macros, knowledge insights, webhooks and exports."""

from __future__ import annotations

import uuid
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, Field, ValidationError

from . import actions, commerce, copilot, db, insights, webhooks, workspace
from .deps import require_admin
from .i18n import LANGUAGES, localize
from .llm import model_name, resolve_provider
from .support_ops import post_specialist_message, resolve_ticket

router = APIRouter(prefix="/api/admin", dependencies=[Depends(require_admin)])


# ------------------------------------------------------------------ workspace settings
@router.get("/settings")
def get_workspace_settings() -> dict[str, Any]:
    return {"settings": workspace.current(), "provider": resolve_provider(), "model": model_name(), "languages": LANGUAGES}


@router.patch("/settings")
def patch_workspace_settings(body: workspace.WorkspacePatch) -> dict[str, Any]:
    try:
        return {"settings": workspace.update(body)}
    except ValidationError as exc:
        raise HTTPException(422, "; ".join(f"{'.'.join(map(str, e['loc']))}: {e['msg']}" for e in exc.errors())) from exc


# ------------------------------------------------------------------ actions & approvals
class ApproveRequest(BaseModel):
    agent_name: str = Field(default="Support Specialist", min_length=1, max_length=80)
    resolve_ticket: bool = True


class DenyRequest(BaseModel):
    agent_name: str = Field(default="Support Specialist", min_length=1, max_length=80)
    note: str | None = Field(default=None, max_length=2000)


def _pending(action_id: str) -> dict[str, Any]:
    action = actions.get(action_id)
    if not action:
        raise HTTPException(404, "Action not found")
    if action["status"] != "pending_approval":
        raise HTTPException(409, f"Action is already {action['status'].replace('_', ' ')}")
    return action


def _conversation_language(conversation_id: str | None) -> str:
    conv = db.get_conversation(conversation_id) if conversation_id else None
    return (conv or {}).get("language") or "en"


@router.get("/actions")
def list_actions(status: str | None = None) -> list[dict[str, Any]]:
    return actions.list_actions(status=status)


@router.post("/actions/{action_id}/approve")
def approve_action(action_id: str, body: ApproveRequest) -> dict[str, Any]:
    action = _pending(action_id)
    result = actions.execute(action_id, decided_by=body.agent_name)
    if result["status"] != "executed":
        raise HTTPException(409, result["result"].get("error", "The action could not be executed"))
    if result["conversation_id"]:
        text = localize(result["result"]["message"], _conversation_language(result["conversation_id"]))
        post_specialist_message(result["conversation_id"], text, body.agent_name, {"action_result": {k: result[k] for k in ("id", "type", "label", "status", "order_id", "amount")}})
    ticket = db.get_ticket(action["ticket_id"]) if action["ticket_id"] else None
    if ticket and body.resolve_ticket and ticket["status"] != "resolved":
        resolve_ticket(ticket["id"], ticket["conversation_id"], body.agent_name)
    return result


@router.post("/actions/{action_id}/deny")
def deny_action(action_id: str, body: DenyRequest) -> dict[str, Any]:
    _pending(action_id)
    result = actions.deny(action_id, body.agent_name, body.note)
    if body.note and result["conversation_id"]:
        post_specialist_message(result["conversation_id"], body.note.strip(), body.agent_name)
    return result


# ------------------------------------------------------------------ macros
class MacroBody(BaseModel):
    title: str = Field(min_length=1, max_length=80)
    body: str = Field(min_length=1, max_length=4000)


@router.get("/macros")
def list_macros() -> list[dict[str, Any]]:
    return db.query("SELECT * FROM macros ORDER BY title")


@router.post("/macros")
def create_macro(body: MacroBody) -> dict[str, Any]:
    macro_id, ts = f"mac_{uuid.uuid4().hex[:8]}", db.now_iso()
    db.insert("macros", {"id": macro_id, "title": body.title, "body": body.body, "created_at": ts, "updated_at": ts})
    return db.get_row("macros", macro_id)  # type: ignore[return-value]


@router.put("/macros/{macro_id}")
def update_macro(macro_id: str, body: MacroBody) -> dict[str, Any]:
    if not db.get_row("macros", macro_id):
        raise HTTPException(404, "Macro not found")
    db.update_row("macros", macro_id, title=body.title, body=body.body, updated_at=db.now_iso())
    return db.get_row("macros", macro_id)  # type: ignore[return-value]


@router.delete("/macros/{macro_id}")
def delete_macro(macro_id: str) -> dict[str, Any]:
    if not db.get_row("macros", macro_id):
        raise HTTPException(404, "Macro not found")
    db.execute("DELETE FROM macros WHERE id = ?", (macro_id,))
    return {"ok": True}


# ------------------------------------------------------------------ copilot
class RewriteRequest(BaseModel):
    text: str = Field(min_length=1, max_length=8000)
    mode: copilot.Mode
    conversation_id: str | None = None
    language: str | None = Field(default=None, max_length=5)


@router.post("/copilot/rewrite")
def copilot_rewrite(body: RewriteRequest) -> dict[str, Any]:
    language = body.language or _conversation_language(body.conversation_id)
    context = ""
    if body.conversation_id:
        recent = db.list_messages(body.conversation_id)[-8:]
        context = "\n".join(f"{m['role']}: {m['content'][:400]}" for m in recent if m["role"] != "system")
    try:
        text, engine = copilot.rewrite(body.text, body.mode, language=language, context=context)
    except copilot.CopilotUnavailable as exc:
        raise HTTPException(422, str(exc)) from exc
    return {"text": text, "engine": engine, "language": language}


# ------------------------------------------------------------------ knowledge insights
class DraftRequest(BaseModel):
    questions: list[str] = Field(min_length=1, max_length=20)


@router.get("/insights/knowledge-gaps")
def knowledge_gaps(days: int = 30) -> list[dict[str, Any]]:
    return insights.knowledge_gaps(days=max(1, min(days, 365)))


@router.post("/kb/drafts")
def draft_article(body: DraftRequest) -> dict[str, Any]:
    return insights.draft_from_questions(body.questions)


@router.post("/kb/drafts/ticket/{ticket_id}")
def draft_article_from_ticket(ticket_id: str) -> dict[str, Any]:
    ticket = db.get_ticket(ticket_id)
    if not ticket:
        raise HTTPException(404, "Ticket not found")
    return insights.draft_from_ticket(ticket, db.list_messages(ticket["conversation_id"]))


# ------------------------------------------------------------------ webhooks
class WebhookCreate(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    url: str = Field(pattern=r"^https?://\S+$", max_length=500)
    kind: Literal["generic", "slack"] = "generic"
    events: list[str] = Field(min_length=1)


class WebhookPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=80)
    active: bool | None = None
    events: list[str] | None = Field(default=None, min_length=1)


def _validate_events(events: list[str] | None) -> None:
    unknown = set(events or []) - set(webhooks.EVENTS)
    if unknown:
        raise HTTPException(422, f"Unknown events: {', '.join(sorted(unknown))}")


@router.get("/webhooks")
def list_webhooks() -> dict[str, Any]:
    return {"webhooks": webhooks.list_all(), "events": webhooks.EVENTS, "deliveries": webhooks.deliveries()}


@router.post("/webhooks")
def create_webhook(body: WebhookCreate) -> dict[str, Any]:
    _validate_events(body.events)
    return webhooks.create(body.name, body.url, body.kind, body.events)


@router.patch("/webhooks/{hook_id}")
def patch_webhook(hook_id: str, body: WebhookPatch) -> dict[str, Any]:
    if not webhooks.get(hook_id):
        raise HTTPException(404, "Webhook not found")
    _validate_events(body.events)
    fields = body.model_dump(exclude_none=True)
    if "active" in fields:
        fields["active"] = int(fields["active"])
    db.update_row("webhooks", hook_id, **fields)
    return webhooks.get(hook_id)  # type: ignore[return-value]


@router.delete("/webhooks/{hook_id}")
def delete_webhook(hook_id: str) -> dict[str, Any]:
    if not webhooks.get(hook_id):
        raise HTTPException(404, "Webhook not found")
    db.execute("DELETE FROM webhooks WHERE id = ?", (hook_id,))
    return {"ok": True}


@router.post("/webhooks/{hook_id}/test")
def test_webhook(hook_id: str) -> dict[str, Any]:
    hook = db.get_row("webhooks", hook_id)
    if not hook:
        raise HTTPException(404, "Webhook not found")
    sample = {"ticket": {"id": "TCK-TEST01", "priority": "high", "category": "Returns", "reason": "Test event from Relay"}}
    envelope = {"id": f"evt_test_{uuid.uuid4().hex[:8]}", "event": "ticket.created", "created_at": db.now_iso(), "data": sample}
    return webhooks.deliver(hook, envelope)


@router.post("/sla/check")
def run_sla_check() -> dict[str, Any]:
    return {"breached": webhooks.check_sla_breaches()}


# ------------------------------------------------------------------ exports & demo
@router.get("/export/{kind}.csv")
def export_csv(kind: Literal["tickets", "conversations"]) -> Response:
    from . import reporting

    content = reporting.tickets_csv() if kind == "tickets" else reporting.conversations_csv()
    return Response(content, media_type="text/csv", headers={"Content-Disposition": f'attachment; filename="relay-{kind}.csv"'})


@router.post("/demo/reset-orders")
def reset_demo_orders() -> dict[str, Any]:
    """Restore demo orders (undo cancellations, returns and refunds made by actions)."""
    commerce.reset_order_state()
    db.execute("DELETE FROM actions")
    return {"ok": True}

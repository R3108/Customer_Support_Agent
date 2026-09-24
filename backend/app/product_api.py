"""Console API for workspace settings, approvals, copilot, macros, knowledge insights, Test Lab, Pulse,
customer health, webhooks, audit log, privacy requests and exports."""

from __future__ import annotations

import json
import uuid
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from pydantic import BaseModel, Field, ValidationError

from . import actions, audit, commerce, copilot, db, evals, health, insights, privacy, pulse, webhooks, workspace
from .agents.escalation_agent import REASONS
from .agents.intents import INTENTS
from .auth import Principal, actor_name
from .deps import require_admin, require_agent
from .i18n import LANGUAGES, localize
from .llm import model_name, resolve_provider
from .support_ops import post_specialist_message, resolve_ticket

# Everything here needs a signed-in console user; workspace configuration additionally needs an admin.
router = APIRouter(prefix="/api/admin", dependencies=[Depends(require_agent)])
admin_only = [Depends(require_admin)]


# ------------------------------------------------------------------ workspace settings
@router.get("/settings", dependencies=admin_only)
def get_workspace_settings() -> dict[str, Any]:
    return {"settings": workspace.current(), "provider": resolve_provider(), "model": model_name(), "languages": LANGUAGES}


@router.patch("/settings", dependencies=admin_only)
def patch_workspace_settings(body: workspace.WorkspacePatch) -> dict[str, Any]:
    before = workspace.current()
    try:
        after = workspace.update(body)
    except ValidationError as exc:
        raise HTTPException(422, "; ".join(f"{'.'.join(map(str, e['loc']))}: {e['msg']}" for e in exc.errors())) from exc
    changes = {k: {"from": before[k], "to": after[k]} for k in after if before[k] != after[k]}
    if changes:
        audit.record("settings.update", "workspace", None, {"changes": changes})
    return {"settings": after}


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


def _action_facts(action: dict[str, Any]) -> dict[str, Any]:
    return {k: action.get(k) for k in ("type", "order_id", "amount", "ticket_id", "conversation_id")}


def _conversation_language(conversation_id: str | None) -> str:
    conv = db.get_conversation(conversation_id) if conversation_id else None
    return (conv or {}).get("language") or "en"


@router.get("/actions")
def list_actions(status: str | None = None) -> list[dict[str, Any]]:
    return actions.list_actions(status=status)


@router.post("/actions/{action_id}/approve")
def approve_action(action_id: str, body: ApproveRequest, principal: Principal = Depends(require_agent)) -> dict[str, Any]:
    action = _pending(action_id)
    name = actor_name(principal, body.agent_name)
    result = actions.execute(action_id, decided_by=name)
    audit.record("action.approve", "action", action_id, {**_action_facts(action), "decided_by": name, "outcome": result["status"]})
    if result["status"] != "executed":
        raise HTTPException(409, result["result"].get("error", "The action could not be executed"))
    if result["conversation_id"]:
        text = localize(result["result"]["message"], _conversation_language(result["conversation_id"]))
        post_specialist_message(result["conversation_id"], text, name, {"action_result": {k: result[k] for k in ("id", "type", "label", "status", "order_id", "amount")}})
    ticket = db.get_ticket(action["ticket_id"]) if action["ticket_id"] else None
    if ticket and body.resolve_ticket and ticket["status"] != "resolved":
        resolve_ticket(ticket["id"], ticket["conversation_id"], name)
    return result


@router.post("/actions/{action_id}/deny")
def deny_action(action_id: str, body: DenyRequest, principal: Principal = Depends(require_agent)) -> dict[str, Any]:
    action = _pending(action_id)
    name = actor_name(principal, body.agent_name)
    result = actions.deny(action_id, name, body.note)
    audit.record("action.deny", "action", action_id, {**_action_facts(action), "decided_by": name, "with_note": bool(body.note)})
    if body.note and result["conversation_id"]:
        post_specialist_message(result["conversation_id"], body.note.strip(), name)
    return result


# ------------------------------------------------------------------ macros
class MacroBody(BaseModel):
    title: str = Field(min_length=1, max_length=80)
    body: str = Field(min_length=1, max_length=4000)


@router.get("/macros")
def list_macros() -> list[dict[str, Any]]:
    return db.query("SELECT * FROM macros ORDER BY title")


@router.post("/macros", dependencies=admin_only)
def create_macro(body: MacroBody) -> dict[str, Any]:
    macro_id, ts = f"mac_{uuid.uuid4().hex[:8]}", db.now_iso()
    db.insert("macros", {"id": macro_id, "title": body.title, "body": body.body, "created_at": ts, "updated_at": ts})
    audit.record("macro.create", "macro", macro_id, {"title": body.title})
    return db.get_row("macros", macro_id)  # type: ignore[return-value]


@router.put("/macros/{macro_id}", dependencies=admin_only)
def update_macro(macro_id: str, body: MacroBody) -> dict[str, Any]:
    if not db.get_row("macros", macro_id):
        raise HTTPException(404, "Macro not found")
    db.update_row("macros", macro_id, title=body.title, body=body.body, updated_at=db.now_iso())
    audit.record("macro.update", "macro", macro_id, {"title": body.title})
    return db.get_row("macros", macro_id)  # type: ignore[return-value]


@router.delete("/macros/{macro_id}", dependencies=admin_only)
def delete_macro(macro_id: str) -> dict[str, Any]:
    macro = db.get_row("macros", macro_id)
    if not macro:
        raise HTTPException(404, "Macro not found")
    db.execute("DELETE FROM macros WHERE id = ?", (macro_id,))
    audit.record("macro.delete", "macro", macro_id, {"title": macro["title"]})
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


# ------------------------------------------------------------------ pulse & customer health
@router.get("/insights/pulse")
def pulse_report() -> dict[str, Any]:
    return pulse.emerging_issues()


@router.get("/insights/customer-health")
def customer_health_report(limit: int = 10) -> dict[str, Any]:
    return health.at_risk_customers(limit=max(1, min(limit, 100)))


@router.get("/customers/{customer_id}/health")
def customer_health(customer_id: str) -> dict[str, Any]:
    result = health.customer_health(customer_id)
    if not result:
        raise HTTPException(404, "Customer not found")
    return result


# ------------------------------------------------------------------ test lab
class RunRequest(BaseModel):
    scenario_ids: list[str] | None = Field(default=None, max_length=200)
    wait: bool = False  # block until finished (scripts / CI); the console runs in the background and streams progress


def _scenario(scenario_id: str) -> dict[str, Any]:
    scenario = evals.get_scenario(scenario_id)
    if not scenario:
        raise HTTPException(404, "Scenario not found")
    return scenario


@router.get("/evals")
def evals_overview() -> dict[str, Any]:
    return {
        **evals.overview(),
        "catalog": {
            "intents": {k: v["label"] for k, v in INTENTS.items()},
            "escalation_reasons": {k: v["label"] for k, v in REASONS.items()},
            "action_types": {k: v["label"] for k, v in actions.ACTION_TYPES.items()},
            "customers": [{"id": c["id"], "name": c["name"], "tier": c["tier"]} for c in commerce.list_customers()],
        },
        "engine": resolve_provider(),
    }


@router.post("/evals/scenarios")
def create_scenario(body: evals.ScenarioBody) -> dict[str, Any]:
    return evals.create_scenario(body)


@router.post("/evals/scenarios/from-conversation/{conversation_id}")
def scenario_from_conversation(conversation_id: str) -> dict[str, Any]:
    try:
        return evals.scenario_from_conversation(conversation_id)
    except LookupError as exc:
        raise HTTPException(404, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc


@router.put("/evals/scenarios/{scenario_id}", dependencies=admin_only)
def update_scenario(scenario_id: str, body: evals.ScenarioBody) -> dict[str, Any]:
    _scenario(scenario_id)
    result = evals.update_scenario(scenario_id, body)
    audit.record("eval_scenario.update", "eval_scenario", scenario_id, {"name": body.name})
    return result


@router.delete("/evals/scenarios/{scenario_id}", dependencies=admin_only)
def delete_scenario(scenario_id: str) -> dict[str, Any]:
    scenario = _scenario(scenario_id)
    evals.delete_scenario(scenario_id)
    audit.record("eval_scenario.delete", "eval_scenario", scenario_id, {"name": scenario["name"]})
    return {"ok": True}


@router.post("/evals/runs")
def start_eval_run(body: RunRequest, principal: Principal = Depends(require_agent)) -> dict[str, Any]:
    try:
        return evals.start_run(body.scenario_ids, triggered_by=actor_name(principal, None, "API key" if principal.kind == "api_key" else "Console"), wait=body.wait)
    except evals.RunInProgress as exc:
        raise HTTPException(409, str(exc)) from exc
    except LookupError as exc:
        raise HTTPException(404, str(exc)) from exc


@router.get("/evals/runs/{run_id}")
def get_eval_run(run_id: str) -> dict[str, Any]:
    run = evals.get_run(run_id)
    if not run:
        raise HTTPException(404, "Run not found")
    return run


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


@router.get("/webhooks", dependencies=admin_only)
def list_webhooks() -> dict[str, Any]:
    return {"webhooks": webhooks.list_all(), "events": webhooks.EVENTS, "deliveries": webhooks.deliveries(),
            "outbox": webhooks.outbox_counts()}


@router.post("/webhooks", dependencies=admin_only)
def create_webhook(body: WebhookCreate) -> dict[str, Any]:
    _validate_events(body.events)
    try:
        webhooks.check_destination(body.url, resolve=False)  # DNS is checked again on every delivery
    except webhooks.UnsafeDestination as exc:
        raise HTTPException(422, f"Webhook URL refused: {exc}") from exc
    hook = webhooks.create(body.name, body.url, body.kind, body.events)
    audit.record("webhook.create", "webhook", hook["id"], {"name": body.name, "url": body.url, "kind": body.kind, "events": body.events})
    return hook


@router.patch("/webhooks/{hook_id}", dependencies=admin_only)
def patch_webhook(hook_id: str, body: WebhookPatch) -> dict[str, Any]:
    if not webhooks.get(hook_id):
        raise HTTPException(404, "Webhook not found")
    _validate_events(body.events)
    fields = body.model_dump(exclude_none=True)
    if "active" in fields:
        fields["active"] = int(fields["active"])
    db.update_row("webhooks", hook_id, **fields)
    audit.record("webhook.update", "webhook", hook_id, {"fields": body.model_dump(exclude_none=True)})
    return webhooks.get(hook_id)  # type: ignore[return-value]


@router.delete("/webhooks/{hook_id}", dependencies=admin_only)
def delete_webhook(hook_id: str) -> dict[str, Any]:
    hook = webhooks.get(hook_id)
    if not hook:
        raise HTTPException(404, "Webhook not found")
    db.execute("DELETE FROM webhooks WHERE id = ?", (hook_id,))
    audit.record("webhook.delete", "webhook", hook_id, {"name": hook["name"], "url": hook["url"]})
    return {"ok": True}


@router.get("/webhooks/outbox", dependencies=admin_only)
def list_outbox(status: Literal["pending", "sending", "delivered", "dead"] | None = None,
                limit: int = Query(100, ge=1, le=500)) -> dict[str, Any]:
    return {"deliveries": webhooks.outbox(status, limit), "counts": webhooks.outbox_counts()}


@router.post("/webhooks/outbox/{delivery_id}/retry", dependencies=admin_only)
def retry_outbox(delivery_id: str) -> dict[str, Any]:
    """Replay a queued or dead-lettered delivery now (the envelope id is unchanged, so receivers can dedupe)."""
    row = db.get_row("webhook_outbox", delivery_id)
    if not row:
        raise HTTPException(404, "Delivery not found")
    if row["status"] not in ("pending", "dead"):
        raise HTTPException(409, f"Delivery is {row['status']}")
    audit.record("webhook.replay", "webhook_delivery", delivery_id, {"event": row["event"], "previous_status": row["status"]})
    return webhooks.attempt(delivery_id, force=True) or db.get_row("webhook_outbox", delivery_id)  # type: ignore[return-value]


@router.post("/webhooks/{hook_id}/test", dependencies=admin_only)
def test_webhook(hook_id: str) -> dict[str, Any]:
    hook = db.get_row("webhooks", hook_id)
    if not hook:
        raise HTTPException(404, "Webhook not found")
    sample = {"ticket": {"id": "TCK-TEST01", "priority": "high", "category": "Returns", "reason": "Test event from Relay"}}
    envelope = {"id": f"evt_test_{uuid.uuid4().hex[:8]}", "event": "ticket.created", "created_at": db.now_iso(), "data": sample}
    return webhooks.deliver(hook, envelope)


@router.post("/sla/check", dependencies=admin_only)
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
    audit.record("demo.reset_orders")
    return {"ok": True}


# ------------------------------------------------------------------ audit log
@router.get("/audit", dependencies=admin_only)
def audit_log(
    action: str | None = Query(None, max_length=80, description='Exact action, or a family like "action.*"'),
    actor: str | None = Query(None, max_length=254),
    target_type: str | None = Query(None, max_length=40),
    target_id: str | None = Query(None, max_length=80),
    before_id: int | None = Query(None, ge=1, description="Pagination cursor: the smallest id of the previous page"),
    limit: int = Query(100, ge=1, le=500),
) -> dict[str, Any]:
    entries = audit.list_entries(action, actor, target_type, target_id, before_id, limit)
    return {"entries": entries, "next_before_id": entries[-1]["id"] if len(entries) == limit else None}


@router.get("/audit/verify", dependencies=admin_only)
def verify_audit_log() -> dict[str, Any]:
    return audit.verify()


# ------------------------------------------------------------------ privacy (data-subject requests)
class EraseRequest(BaseModel):
    confirm: str = Field(min_length=1, max_length=80, description="Repeat the id being erased, to guard against accidents")


@router.get("/customers/{customer_id}/export", dependencies=admin_only)
def export_customer_data(customer_id: str) -> Response:
    """Everything Relay stores about a customer, as a JSON download (GDPR art. 15 / CCPA access request)."""
    data = privacy.export_customer(customer_id)
    if data is None:
        raise HTTPException(404, "Customer not found")
    audit.record("customer.export", "customer", customer_id, {"conversations": len(data["conversations"])})
    return Response(json.dumps(data, indent=2, default=str), media_type="application/json",
                    headers={"Content-Disposition": f'attachment; filename="relay-{customer_id}-export.json"'})


@router.post("/customers/{customer_id}/erase", dependencies=admin_only)
def erase_customer_data(customer_id: str, body: EraseRequest) -> dict[str, Any]:
    """Anonymize a customer's conversations and delete their agent memory (GDPR art. 17 / CCPA deletion)."""
    if body.confirm != customer_id:
        raise HTTPException(422, "confirm must equal the customer id")
    counts = privacy.erase_customer(customer_id)
    audit.record("customer.erase", "customer", customer_id, counts)
    return {"ok": True, "erased": counts}


@router.post("/conversations/{conversation_id}/erase", dependencies=admin_only)
def erase_conversation_data(conversation_id: str, body: EraseRequest) -> dict[str, Any]:
    """Erase one conversation, e.g. a guest's, who has no customer id to erase by."""
    if body.confirm != conversation_id:
        raise HTTPException(422, "confirm must equal the conversation id")
    if not db.get_conversation(conversation_id):
        raise HTTPException(404, "Conversation not found")
    counts = privacy.erase_conversations([conversation_id])
    audit.record("conversation.erase", "conversation", conversation_id, counts)
    return {"ok": True, "erased": counts}

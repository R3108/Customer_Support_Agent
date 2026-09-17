"""Workspace settings editable at runtime from the console.

Environment variables provide defaults; values saved here are persisted in the database
and layered onto the cached `Settings` object, so every agent picks them up immediately.
"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field, field_validator

from . import db
from .config import get_settings


class WorkspaceSettings(BaseModel):
    company_name: str = Field(min_length=1, max_length=80)
    assistant_name: str = Field(min_length=1, max_length=40)
    accent_color: str = Field(pattern=r"^#[0-9a-fA-F]{6}$")
    welcome_message: str = Field(min_length=1, max_length=400)
    suggested_prompts: list[str] = Field(max_length=6)
    confidence_threshold: float = Field(ge=0.3, le=0.95)
    refund_approval_limit: float = Field(ge=0, le=100_000)
    low_confidence_streak_limit: int = Field(ge=1, le=10)
    auto_actions_enabled: bool
    multilingual_enabled: bool
    minutes_per_human_ticket: float = Field(ge=0, le=240)
    cost_per_agent_hour: float = Field(ge=0, le=1000)

    @field_validator("suggested_prompts")
    @classmethod
    def _clean_prompts(cls, prompts: list[str]) -> list[str]:
        cleaned = [p.strip()[:80] for p in prompts if p.strip()]
        return list(dict.fromkeys(cleaned))


class WorkspacePatch(BaseModel):
    """Partial update: every field optional, validated against WorkspaceSettings on merge."""

    model_config = {"extra": "forbid"}

    company_name: str | None = None
    assistant_name: str | None = None
    accent_color: str | None = None
    welcome_message: str | None = None
    suggested_prompts: list[str] | None = None
    confidence_threshold: float | None = None
    refund_approval_limit: float | None = None
    low_confidence_streak_limit: int | None = None
    auto_actions_enabled: bool | None = None
    multilingual_enabled: bool | None = None
    minutes_per_human_ticket: float | None = None
    cost_per_agent_hour: float | None = None


FIELDS = tuple(WorkspaceSettings.model_fields)


def current() -> dict[str, Any]:
    s = get_settings()
    return {name: getattr(s, name) for name in FIELDS}


def apply_overrides() -> None:
    """Layer persisted values onto the cached settings (call at startup)."""
    stored = {k: v for k, v in db.load_workspace_settings().items() if k in FIELDS}
    if not stored:
        return
    try:
        merged = WorkspaceSettings.model_validate({**current(), **stored})
    except ValueError:
        return  # a bad stored value must never stop the API from starting
    _set(merged)


def update(patch: WorkspacePatch) -> dict[str, Any]:
    changes = patch.model_dump(exclude_none=True)
    merged = WorkspaceSettings.model_validate({**current(), **changes})
    db.save_workspace_settings({k: getattr(merged, k) for k in changes})
    _set(merged)
    return current()


def _set(values: WorkspaceSettings) -> None:
    settings = get_settings()
    for name in FIELDS:
        setattr(settings, name, getattr(values, name))

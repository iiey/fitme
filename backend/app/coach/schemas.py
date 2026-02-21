from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict


class CoachConfigRequest(BaseModel):
    provider: str
    model: str
    # Blank on update means "keep the stored key" (mirrors the sync config).
    api_key: str = ""
    base_url: str | None = None
    enabled: bool = True


class CoachConfigResponse(BaseModel):
    provider: str
    model: str
    has_api_key: bool
    base_url: str | None
    enabled: bool
    last_status: str | None
    last_message: str | None
    updated_on: datetime | None = None


class CoachVerifyRequest(BaseModel):
    """Settings to test. Any field left unset falls back to the stored config."""

    provider: str | None = None
    model: str | None = None
    api_key: str = ""
    base_url: str | None = None


class CoachVerifyResult(BaseModel):
    ok: bool
    message: str


class CoachStatusResponse(BaseModel):
    configured: bool
    enabled: bool
    # usable = configured and enabled and the last verification succeeded.
    # The frontend shows the coach launcher only when this is true.
    usable: bool
    provider: str | None = None
    model: str | None = None
    last_status: str | None = None
    last_message: str | None = None


class CoachSessionResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    title: str
    created_on: datetime
    updated_on: datetime


class CoachMessageResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    role: str
    content: str
    created_on: datetime


class CoachSessionRenameRequest(BaseModel):
    title: str


class CoachChatContext(BaseModel):
    """What the user is currently viewing, derived from the route by the UI."""

    view: str | None = None
    activity_id: str | None = None


class CoachSkillResponse(BaseModel):
    """A selectable coaching skill, for the chat "/" menu. Body is not exposed."""

    id: str
    name: str
    description: str


class CoachChatRequest(BaseModel):
    message: str
    # When omitted a new session is created and its id returned in the done event.
    session_id: int | None = None
    context: CoachChatContext | None = None
    # Optional skill id chosen from the "/" menu; applied to this message only.
    skill: str | None = None


class CoachMemoryResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    content: str
    created_on: datetime


class PlannedSession(BaseModel):
    day: str
    sport: str
    workout_type: str
    description: str
    target_distance_km: float | None = None
    target_duration_min: int | None = None
    intensity: str | None = None


class PlannedWeek(BaseModel):
    week: int
    focus: str
    sessions: list[PlannedSession]


class TrainingPlan(BaseModel):
    title: str
    summary: str
    weeks: list[PlannedWeek]


class CoachPlanRequest(BaseModel):
    goal: str
    weeks: int = 4
    context: CoachChatContext | None = None


class CoachPlanResponse(BaseModel):
    # Exactly one is set: a structured plan, or a clarifying message from the coach.
    plan: TrainingPlan | None = None
    message: str | None = None

from __future__ import annotations

from collections.abc import AsyncIterator

from sqlalchemy.orm import Session

from app.athlete import AthleteConfig
from app.coach import store
from app.coach.agent import coach_agent
from app.coach.config import CONFIG_ID
from app.coach.deps import CoachDeps, CoachView
from app.coach.models import CoachConfig, CoachMessage
from app.coach.provider import build_model
from app.coach.schemas import TrainingPlan

# Bounds for the requested plan length.
_MIN_PLAN_WEEKS = 1
_MAX_PLAN_WEEKS = 12

# Cap how much prior conversation is replayed to the model each turn, so context
# (and latency/cost) stays bounded on long chats. Tools re-fetch live data anyway.
_MAX_HISTORY_MESSAGES = 20


class CoachUnavailable(RuntimeError):
    """Raised when a chat is attempted but the coach is not configured/enabled."""


def friendly_error(exc: Exception) -> str:
    """Map a provider/runtime error to a short, user-facing message."""
    text = str(exc).strip()
    low = text.lower()
    if any(
        k in low for k in ("refused", "connection", "could not connect", "timeout", "timed out")
    ):
        return (
            "Could not reach the model provider. Check it is running and the base URL is correct."
        )
    if any(k in low for k in ("api key", "unauthorized", "authentication", "401", "403")):
        return "The model provider rejected the API key."
    if "not found" in low or "404" in low:
        return "The configured model was not found by the provider."
    return (text.splitlines()[0] if text else "Unknown error.")[:300]


def _require_model(coach_db: Session):
    config = coach_db.get(CoachConfig, CONFIG_ID)
    if config is None or not config.enabled:
        raise CoachUnavailable("The AI coach is not configured.")
    return build_model(config)


def _build_deps(
    *,
    coach_db: Session,
    core_db: Session,
    athlete_id: str,
    athlete: AthleteConfig,
    view: CoachView,
    session_id: int | None,
) -> CoachDeps:
    memory = [m.content for m in store.list_memory(coach_db, athlete_id)]
    return CoachDeps(
        core_db=core_db,
        coach_db=coach_db,
        athlete_id=athlete_id,
        athlete=athlete,
        view=view,
        memory=memory,
        session_id=session_id,
    )


def _message_history(messages: list[CoachMessage]) -> list:
    """Rebuild a model-agnostic history from stored turns.

    We keep plain user/assistant text (not serialized tool calls) so history
    stays valid even when the provider or model is switched between turns; the
    agent simply re-runs tools against live data on each turn.
    """
    from pydantic_ai.messages import (
        ModelRequest,
        ModelResponse,
        TextPart,
        UserPromptPart,
    )

    history: list = []
    for message in messages:
        if message.role == "user":
            history.append(ModelRequest(parts=[UserPromptPart(content=message.content)]))
        elif message.role == "assistant" and message.content:
            history.append(ModelResponse(parts=[TextPart(content=message.content)]))
    return history


async def stream_chat(
    *,
    coach_db: Session,
    core_db: Session,
    athlete_id: str,
    athlete: AthleteConfig,
    session_id: int,
    message: str,
    view: CoachView,
) -> AsyncIterator[str]:
    """Stream the assistant's reply token-by-token, persisting both turns.

    Yields text deltas. The caller owns the database sessions and must keep them
    open for the whole stream.
    """
    model = _require_model(coach_db)
    recent = store.list_messages(coach_db, session_id)[-_MAX_HISTORY_MESSAGES:]
    history = _message_history(recent)

    # Persist the user's turn before the run so it survives a provider failure.
    store.add_message(coach_db, session_id, "user", message)

    deps = _build_deps(
        coach_db=coach_db,
        core_db=core_db,
        athlete_id=athlete_id,
        athlete=athlete,
        view=view,
        session_id=session_id,
    )
    answer_parts: list[str] = []
    async with coach_agent.run_stream(
        message, model=model, deps=deps, message_history=history
    ) as result:
        async for delta in result.stream_text(delta=True):
            answer_parts.append(delta)
            yield delta

    store.add_message(coach_db, session_id, "assistant", "".join(answer_parts))


async def generate_plan(
    *,
    coach_db: Session,
    core_db: Session,
    athlete_id: str,
    athlete: AthleteConfig,
    goal: str,
    weeks: int,
    view: CoachView,
) -> TrainingPlan | str:
    """Generate a structured training plan (or a clarifying question as text).

    Runs the same agent (so it can use the skill tools to ground the plan) but
    with a structured output type. Returns a TrainingPlan, or a string when the
    model needs more information.
    """
    model = _require_model(coach_db)
    weeks = max(_MIN_PLAN_WEEKS, min(weeks, _MAX_PLAN_WEEKS))
    deps = _build_deps(
        coach_db=coach_db,
        core_db=core_db,
        athlete_id=athlete_id,
        athlete=athlete,
        view=view,
        session_id=None,
    )
    prompt = (
        f"Create a realistic, progressive {weeks}-week training plan for this goal: {goal}.\n"
        "First use your tools to review the athlete's recent activities, training load, "
        "and zones, then tailor the plan to their current fitness. Include rest days and "
        "vary intensity sensibly."
    )
    result = await coach_agent.run(prompt, model=model, deps=deps, output_type=[TrainingPlan, str])
    return result.output

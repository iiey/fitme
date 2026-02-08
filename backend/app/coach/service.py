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


class CoachUnavailable(RuntimeError):
    """Raised when a chat is attempted but the coach is not configured/enabled."""


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
    config = coach_db.get(CoachConfig, CONFIG_ID)
    if config is None or not config.enabled:
        raise CoachUnavailable("The AI coach is not configured.")

    model = build_model(config)
    history = _message_history(store.list_messages(coach_db, session_id))

    # Persist the user's turn before the run so it survives a provider failure.
    store.add_message(coach_db, session_id, "user", message)

    deps = CoachDeps(core_db=core_db, athlete_id=athlete_id, athlete=athlete, view=view)
    answer_parts: list[str] = []
    async with coach_agent.run_stream(
        message, model=model, deps=deps, message_history=history
    ) as result:
        async for delta in result.stream_text(delta=True):
            answer_parts.append(delta)
            yield delta

    store.add_message(coach_db, session_id, "assistant", "".join(answer_parts))

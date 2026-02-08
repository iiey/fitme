from __future__ import annotations

import json
import logging
from collections.abc import AsyncIterator

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.api.athletes import get_required_athlete_id
from app.athlete import get_athlete_config
from app.coach import service, store
from app.coach.config import CONFIG_ID, Provider
from app.coach.db import SessionLocal as CoachSessionLocal
from app.coach.db import get_coach_db
from app.coach.deps import CoachView
from app.coach.models import CoachConfig
from app.coach.schemas import (
    CoachChatContext,
    CoachChatRequest,
    CoachConfigRequest,
    CoachConfigResponse,
    CoachMemoryResponse,
    CoachMessageResponse,
    CoachPlanRequest,
    CoachPlanResponse,
    CoachSessionRenameRequest,
    CoachSessionResponse,
    CoachStatusResponse,
    CoachVerifyRequest,
    CoachVerifyResult,
    TrainingPlan,
)
from app.coach.service import CoachUnavailable, friendly_error
from app.coach.verify import verify_connection
from app.db import SessionLocal as CoreSessionLocal

logger = logging.getLogger("fitme.coach")

# Reject oversized chat messages before they reach the model.
_MAX_MESSAGE_CHARS = 4000

router = APIRouter(prefix="/api/coach", tags=["coach"])


def _load_config(db: Session) -> CoachConfig | None:
    return db.get(CoachConfig, CONFIG_ID)


def _to_response(config: CoachConfig) -> CoachConfigResponse:
    return CoachConfigResponse(
        provider=config.provider,
        model=config.model,
        has_api_key=bool(config.api_key),
        base_url=config.base_url,
        enabled=config.enabled,
        last_status=config.last_status,
        last_message=config.last_message,
        updated_on=config.updated_on,
    )


def _is_usable(config: CoachConfig | None) -> bool:
    return bool(config and config.enabled and config.last_status == "ok")


def _validate_provider(provider: str) -> None:
    try:
        Provider(provider)
    except ValueError:
        raise HTTPException(422, f"Unknown provider: {provider!r}") from None


@router.get("/config", response_model=CoachConfigResponse | None)
def get_config(db: Session = Depends(get_coach_db)) -> CoachConfigResponse | None:
    config = _load_config(db)
    return _to_response(config) if config is not None else None


@router.put("/config", response_model=CoachConfigResponse)
async def put_config(
    payload: CoachConfigRequest, db: Session = Depends(get_coach_db)
) -> CoachConfigResponse:
    """Verify connectivity, then create/update the single config row.

    Saving always re-verifies so a stored config is known-good. An empty api_key
    keeps the previously stored key (mirrors the Intervals.icu sync config).
    """
    _validate_provider(payload.provider)
    existing = _load_config(db)
    api_key = payload.api_key.strip() or (existing.api_key if existing else None)

    candidate = CoachConfig(
        provider=payload.provider,
        model=payload.model,
        api_key=api_key,
        base_url=payload.base_url or None,
        enabled=payload.enabled,
    )
    ok, message = await verify_connection(candidate)
    if not ok:
        raise HTTPException(400, f"Verification failed: {message}")

    config = existing or CoachConfig(id=CONFIG_ID)
    config.provider = payload.provider
    config.model = payload.model
    config.api_key = api_key
    config.base_url = payload.base_url or None
    config.enabled = payload.enabled
    config.last_status = "ok"
    config.last_message = message
    db.add(config)
    db.commit()
    db.refresh(config)
    return _to_response(config)


@router.delete("/config", status_code=204)
def delete_config(db: Session = Depends(get_coach_db)) -> None:
    config = _load_config(db)
    if config is not None:
        db.delete(config)
        db.commit()


@router.delete("/data", status_code=204)
def reset_all(db: Session = Depends(get_coach_db)) -> None:
    """Full wipe: delete the config plus all sessions, messages, and memory."""
    store.reset_all(db)


@router.post("/config/verify", response_model=CoachVerifyResult)
async def verify_config(
    payload: CoachVerifyRequest, db: Session = Depends(get_coach_db)
) -> CoachVerifyResult:
    """Test entered (or stored) settings without saving - powers the Verify button."""
    existing = _load_config(db)
    provider = payload.provider or (existing.provider if existing else None)
    model = payload.model or (existing.model if existing else None)
    if not provider or not model:
        raise HTTPException(422, "Provider and model are required.")
    _validate_provider(provider)

    candidate = CoachConfig(
        provider=provider,
        model=model,
        api_key=payload.api_key.strip() or (existing.api_key if existing else None),
        base_url=payload.base_url or (existing.base_url if existing else None),
        enabled=True,
    )
    ok, message = await verify_connection(candidate)
    return CoachVerifyResult(ok=ok, message=message)


@router.get("/status", response_model=CoachStatusResponse)
def get_status(db: Session = Depends(get_coach_db)) -> CoachStatusResponse:
    config = _load_config(db)
    return CoachStatusResponse(
        configured=config is not None,
        enabled=bool(config and config.enabled),
        usable=_is_usable(config),
        provider=config.provider if config else None,
        model=config.model if config else None,
        last_status=config.last_status if config else None,
        last_message=config.last_message if config else None,
    )


# -- Chat sessions ----------------------------------------------------------


@router.get("/sessions", response_model=list[CoachSessionResponse])
def list_sessions(
    db: Session = Depends(get_coach_db),
    athlete_id: str = Depends(get_required_athlete_id),
) -> list[CoachSessionResponse]:
    return [CoachSessionResponse.model_validate(s) for s in store.list_sessions(db, athlete_id)]


@router.post("/sessions", response_model=CoachSessionResponse)
def create_session(
    db: Session = Depends(get_coach_db),
    athlete_id: str = Depends(get_required_athlete_id),
) -> CoachSessionResponse:
    return CoachSessionResponse.model_validate(store.create_session(db, athlete_id))


@router.patch("/sessions/{session_id}", response_model=CoachSessionResponse)
def rename_session(
    session_id: int,
    payload: CoachSessionRenameRequest,
    db: Session = Depends(get_coach_db),
    athlete_id: str = Depends(get_required_athlete_id),
) -> CoachSessionResponse:
    session = store.rename_session(db, session_id, athlete_id, payload.title)
    if session is None:
        raise HTTPException(404, "Session not found.")
    return CoachSessionResponse.model_validate(session)


@router.delete("/sessions/{session_id}", status_code=204)
def delete_session(
    session_id: int,
    db: Session = Depends(get_coach_db),
    athlete_id: str = Depends(get_required_athlete_id),
) -> None:
    if not store.delete_session(db, session_id, athlete_id):
        raise HTTPException(404, "Session not found.")


@router.get("/sessions/{session_id}/messages", response_model=list[CoachMessageResponse])
def get_session_messages(
    session_id: int,
    db: Session = Depends(get_coach_db),
    athlete_id: str = Depends(get_required_athlete_id),
) -> list[CoachMessageResponse]:
    if store.get_session(db, session_id, athlete_id) is None:
        raise HTTPException(404, "Session not found.")
    return [CoachMessageResponse.model_validate(m) for m in store.list_messages(db, session_id)]


# -- Streaming chat ---------------------------------------------------------


def _sse(payload: dict) -> bytes:
    """Encode one Server-Sent Event line."""
    return f"data: {json.dumps(payload)}\n\n".encode()


@router.post("/chat")
async def chat(
    request: Request,
    payload: CoachChatRequest,
    athlete_id: str = Depends(get_required_athlete_id),
) -> StreamingResponse:
    """Stream a coach reply as Server-Sent Events.

    Events: ``session`` (id + title), ``delta`` (text chunk), ``done``, ``error``.
    The DB sessions are opened inside the generator so they outlive the request
    function and stay valid for the whole stream.
    """
    message = payload.message.strip()
    if not message:
        raise HTTPException(422, "Message is required.")
    if len(message) > _MAX_MESSAGE_CHARS:
        raise HTTPException(422, "Message is too long.")
    context = payload.context or CoachChatContext()
    view = CoachView(view=context.view, activity_id=context.activity_id)

    async def event_stream() -> AsyncIterator[bytes]:
        coach_db = CoachSessionLocal()
        core_db = CoreSessionLocal()
        try:
            athlete = get_athlete_config(core_db, athlete_id)
            session = None
            if payload.session_id is not None:
                session = store.get_session(coach_db, payload.session_id, athlete_id)
            if session is None:
                session = store.create_session(
                    coach_db, athlete_id, store.title_from_message(message)
                )
            yield _sse({"type": "session", "session_id": session.id, "title": session.title})

            async for delta in service.stream_chat(
                coach_db=coach_db,
                core_db=core_db,
                athlete_id=athlete_id,
                athlete=athlete,
                session_id=session.id,
                message=message,
                view=view,
            ):
                # Stop early if the user closed the drawer / navigated away.
                if await request.is_disconnected():
                    break
                yield _sse({"type": "delta", "text": delta})
            yield _sse({"type": "done"})
        except CoachUnavailable as exc:
            yield _sse({"type": "error", "message": str(exc)})
        except Exception as exc:  # noqa: BLE001 - report provider/runtime errors to the client
            logger.exception("Coach chat failed")
            yield _sse({"type": "error", "message": friendly_error(exc)})
        finally:
            coach_db.close()
            core_db.close()

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# -- Long-term memory -------------------------------------------------------


@router.get("/memory", response_model=list[CoachMemoryResponse])
def list_memory(
    db: Session = Depends(get_coach_db),
    athlete_id: str = Depends(get_required_athlete_id),
) -> list[CoachMemoryResponse]:
    return [CoachMemoryResponse.model_validate(m) for m in store.list_memory(db, athlete_id)]


@router.delete("/memory/{memory_id}", status_code=204)
def delete_memory(
    memory_id: int,
    db: Session = Depends(get_coach_db),
    athlete_id: str = Depends(get_required_athlete_id),
) -> None:
    if not store.delete_memory(db, memory_id, athlete_id):
        raise HTTPException(404, "Memory not found.")


# -- Training plan generation -----------------------------------------------


@router.post("/plan", response_model=CoachPlanResponse)
async def create_plan(
    payload: CoachPlanRequest,
    athlete_id: str = Depends(get_required_athlete_id),
) -> CoachPlanResponse:
    """Generate a structured training plan (or a clarifying message)."""
    goal = payload.goal.strip()
    if not goal:
        raise HTTPException(422, "A goal is required.")
    context = payload.context or CoachChatContext()
    view = CoachView(view=context.view, activity_id=context.activity_id)

    coach_db = CoachSessionLocal()
    core_db = CoreSessionLocal()
    try:
        athlete = get_athlete_config(core_db, athlete_id)
        output = await service.generate_plan(
            coach_db=coach_db,
            core_db=core_db,
            athlete_id=athlete_id,
            athlete=athlete,
            goal=goal,
            weeks=payload.weeks,
            view=view,
        )
        if isinstance(output, TrainingPlan):
            return CoachPlanResponse(plan=output)
        return CoachPlanResponse(message=str(output))
    except CoachUnavailable as exc:
        raise HTTPException(400, str(exc)) from None
    except Exception as exc:
        logger.exception("Plan generation failed")
        raise HTTPException(502, friendly_error(exc)) from None
    finally:
        coach_db.close()
        core_db.close()

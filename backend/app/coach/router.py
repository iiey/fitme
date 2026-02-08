from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.coach.config import CONFIG_ID, Provider
from app.coach.db import get_coach_db
from app.coach.models import CoachConfig
from app.coach.schemas import (
    CoachConfigRequest,
    CoachConfigResponse,
    CoachStatusResponse,
    CoachVerifyRequest,
    CoachVerifyResult,
)
from app.coach.verify import verify_connection

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

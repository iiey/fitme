"""HTTP API for continuous Intervals.icu sync.

Exposes configuration CRUD (with credential validation and a redacted key),
a manual trigger that runs a sync in the background under the shared ingestion
lock (so sync and bulk import never write concurrently), and a status endpoint
the UI - or an external cron - can poll.
"""

from __future__ import annotations

import logging
import threading
from datetime import date, datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.concurrency import import_lock
from app.db import SessionLocal, get_db
from app.ingestion.intervals import (
    IntervalsAuthError,
    IntervalsClient,
    IntervalsError,
)
from app.ingestion.sync import PROVIDER, sync
from app.models import AthleteProfile, SyncConfig
from app.schemas import (
    SyncConfigRequest,
    SyncConfigResponse,
    SyncRunResult,
    SyncStatusResponse,
    SyncTriggerRequest,
)

logger = logging.getLogger("fitme.sync")

router = APIRouter(prefix="/api/sync", tags=["sync"])


def _athlete_name(db: Session, athlete_id: str) -> str | None:
    profile = db.get(AthleteProfile, athlete_id)
    if profile is None:
        return None
    name = " ".join(p for p in (profile.first_name, profile.last_name) if p)
    return name or None


def _to_response(db: Session, config: SyncConfig) -> SyncConfigResponse:
    return SyncConfigResponse(
        provider=config.provider,
        athlete_id=config.athlete_id,
        athlete_name=_athlete_name(db, config.athlete_id),
        icu_athlete_id=config.icu_athlete_id,
        enabled=config.enabled,
        has_api_key=bool(config.api_key),
        synced_through=config.synced_through,
        last_run_at=config.last_run_at,
        last_status=config.last_status,
        last_message=config.last_message,
    )


def _load_config(db: Session) -> SyncConfig | None:
    return db.get(SyncConfig, PROVIDER)


@router.get("/config", response_model=SyncConfigResponse | None)
def get_config(db: Session = Depends(get_db)) -> SyncConfigResponse | None:
    config = _load_config(db)
    return _to_response(db, config) if config is not None else None


@router.put("/config", response_model=SyncConfigResponse)
def put_config(payload: SyncConfigRequest, db: Session = Depends(get_db)) -> SyncConfigResponse:
    """Validate credentials against Intervals.icu, then create/update the config."""
    if db.get(AthleteProfile, payload.athlete_id) is None:
        raise HTTPException(404, "Unknown athlete. Import data for them first.")

    existing = _load_config(db)
    # An empty key on an existing config means "keep the stored key".
    api_key = payload.api_key.strip() or (existing.api_key if existing else "")
    if not api_key:
        raise HTTPException(422, "An API key is required.")

    icu_athlete_id = payload.icu_athlete_id.strip() or "0"
    try:
        with IntervalsClient(api_key, icu_athlete_id) as client:
            client.test_connection()
    except IntervalsAuthError:
        raise HTTPException(401, "Intervals.icu rejected the API key or athlete id.") from None
    except IntervalsError as exc:
        raise HTTPException(502, f"Could not reach Intervals.icu: {exc}") from None

    config = existing or SyncConfig(provider=PROVIDER)
    config.athlete_id = payload.athlete_id
    config.api_key = api_key
    config.icu_athlete_id = icu_athlete_id
    config.enabled = payload.enabled
    db.add(config)
    db.commit()
    db.refresh(config)
    return _to_response(db, config)


@router.delete("/config", status_code=204)
def delete_config(db: Session = Depends(get_db)) -> None:
    config = _load_config(db)
    if config is not None:
        db.delete(config)
        db.commit()


@router.get("/status", response_model=SyncStatusResponse)
def get_status(db: Session = Depends(get_db)) -> SyncStatusResponse:
    config = _load_config(db)
    if config is None:
        return SyncStatusResponse(configured=False)
    return SyncStatusResponse(
        configured=True,
        enabled=config.enabled,
        running=config.last_status == "running",
        synced_through=config.synced_through,
        last_run_at=config.last_run_at,
        last_status=config.last_status,
        last_message=config.last_message,
    )


def _run_sync_job(
    provider: str,
    full_resync: bool,
    *,
    since: date | None = None,
    until: date | None = None,
    stamp_auto_date: bool = False,
) -> None:
    """Execute a sync in the background, then release the shared lock.

    Uses its own session (``expire_on_commit=False`` so progressively committed
    ORM objects stay usable across the run's commits). The engine owns the
    config row's run lifecycle, marking it ``ok``/``error``.

    When ``stamp_auto_date`` is set, the once-per-day marker is written only
    after a successful run (``sync`` raises on failure), so a failed startup
    sync retries on the next app start instead of being skipped until tomorrow.
    """
    db = SessionLocal()
    db.expire_on_commit = False
    try:
        config = db.get(SyncConfig, provider)
        if config is not None:
            sync(db, config, full_resync=full_resync, since=since, until=until)
            if stamp_auto_date:
                config.last_auto_sync_on = datetime.utcnow().date()
                db.add(config)
                db.commit()
    except Exception:
        logger.exception("Background sync failed")
    finally:
        db.close()
        import_lock.release()


def maybe_start_daily_sync() -> None:
    """Start one Intervals.icu sync on the first app start of the day.

    Called from the app lifespan. It is a deliberate no-op when:

    * sync is not configured, is disabled, or has no stored API key;
    * an automatic sync already ran today, so repeated restarts on the same day
      do not re-trigger it;
    * an import or another sync is already holding the ingestion lock.

    On a go, it runs in a background thread under the shared ingestion lock,
    exactly like the manual trigger, and progress is observable via
    ``GET /api/sync/status``. A startup convenience must never stop the app from
    coming up, so any failure here is logged and swallowed rather than raised.
    """
    try:
        _start_daily_sync()
    except Exception:
        logger.exception("Startup sync could not be started")


def _start_daily_sync() -> None:
    db = SessionLocal()
    try:
        config = db.get(SyncConfig, PROVIDER)
        if config is None or not config.enabled or not config.api_key:
            logger.info("Startup sync skipped: Intervals.icu sync is not configured.")
            return

        today = datetime.utcnow().date()
        if config.last_auto_sync_on == today:
            logger.info("Startup sync skipped: already synced today.")
            return

        if not import_lock.acquire(blocking=False):
            logger.info("Startup sync skipped: an import or sync is already running.")
            return

        # The lock is now ours; hand it to the worker thread, or release it if we
        # fail to do so. The worker (_run_sync_job) releases it when it finishes.
        try:
            # Mark running before spawning the worker so the status endpoint
            # reflects it immediately. The daily marker is stamped by the worker
            # only on success, so a failed run retries on the next app start.
            config.last_status = "running"
            config.last_run_at = datetime.utcnow()
            db.add(config)
            db.commit()
            threading.Thread(
                target=_run_sync_job,
                args=(config.provider, False),
                kwargs={"stamp_auto_date": True},
                daemon=True,
            ).start()
        except Exception:
            import_lock.release()
            raise
    finally:
        db.close()


@router.post("/trigger", response_model=SyncRunResult)
def trigger_sync(
    payload: SyncTriggerRequest | None = None, db: Session = Depends(get_db)
) -> SyncRunResult:
    """Start a sync now (used by the UI button and by external cron).

    Acquires the shared ingestion lock non-blocking so a sync never overlaps a
    bulk import; the run itself proceeds in a background thread and its progress
    is observable via ``GET /api/sync/status``.
    """
    config = _load_config(db)
    if config is None:
        raise HTTPException(404, "Sync is not configured.")
    if not config.enabled:
        raise HTTPException(409, "Sync is disabled.")

    if not import_lock.acquire(blocking=False):
        raise HTTPException(409, "An import or sync is already running.")

    full_resync = bool(payload and payload.full_resync)
    since = payload.oldest if payload else None
    until = payload.newest if payload else None
    # A bounded window is a full resync confined to that window: re-fetch (with
    # the unchanged-skip off) everything inside it rather than just new rows.
    if since is not None or until is not None:
        full_resync = True
    # Mark running up-front so the status endpoint reflects it immediately.
    config.last_status = "running"
    config.last_run_at = datetime.utcnow()
    db.add(config)
    db.commit()

    try:
        threading.Thread(
            target=_run_sync_job,
            args=(config.provider, full_resync),
            kwargs={"since": since, "until": until},
            daemon=True,
        ).start()
    except Exception as exc:
        import_lock.release()
        logger.exception("Failed to start sync")
        raise HTTPException(500, f"Failed to start sync: {exc}") from None

    return SyncRunResult(status="ok", message="Sync started.")

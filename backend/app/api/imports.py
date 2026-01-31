from __future__ import annotations

import json
import logging
import threading
from datetime import datetime
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.concurrency import import_lock as _import_lock
from app.config import settings
from app.db import SessionLocal, get_db
from app.ingestion.export import AthleteProfileRow, ExportReader
from app.ingestion.garmin import GarminExportReader, is_garmin_export
from app.ingestion.importer import import_export
from app.models import AthleteProfile, ImportRun, SourceIdentity
from app.schemas import ImportPreview, ImportRequest, ImportRunStatus

logger = logging.getLogger("fitme.import")

router = APIRouter(prefix="/api/import", tags=["import"])

_ALLOWED_UPLOAD_SUFFIXES = {".zip"}
MAX_UPLOAD_BYTES = 500 * 1024 * 1024


def _run_status(run: ImportRun) -> ImportRunStatus:
    """Build a status response from a run row, merging its progress message."""
    data: dict = {}
    if run.message:
        try:
            data = json.loads(run.message)
        except json.JSONDecodeError:
            data = {}
    return ImportRunStatus(
        id=run.id,
        status=run.status,
        source=run.source,
        added=data.get("added", run.activities_added),
        updated=data.get("updated", run.activities_updated),
        skipped=data.get("skipped", run.activities_skipped),
        deduped=data.get("deduped", 0),
        gear_upserted=data.get("gear_upserted", run.gear_upserted),
        files_parsed=data.get("files_parsed", 0),
        parse_errors=data.get("parse_errors", 0),
        total=data.get("total"),
        processed=data.get("processed", 0),
        finished_at=run.finished_at,
        message=data.get("error"),
    )


def _run_import_job(
    source: Path | str,
    provider: str | None,
    run_id: int,
    cleanup_path: Path | None,
    force: bool,
    target_athlete_id: str | None,
) -> None:
    """Execute an import in the background, then release the import lock.

    Uses its own session (``expire_on_commit=False`` so progressively committed
    ORM objects stay usable across the many commits an import performs). The
    importer owns the run's lifecycle, marking it ``ok``/``error``; here we only
    clean up the uploaded file on failure and always release the lock.
    """
    db = SessionLocal()
    db.expire_on_commit = False
    try:
        import_export(
            db,
            source,
            provider=provider,
            force=force,
            run_id=run_id,
            target_athlete_id=target_athlete_id,
        )
    except Exception:
        logger.exception("Background import failed")
        if cleanup_path is not None:
            cleanup_path.unlink(missing_ok=True)
    finally:
        db.close()
        _import_lock.release()


def _start_import(
    db: Session,
    source: Path | str,
    *,
    provider: str | None,
    cleanup_path: Path | None,
    force: bool = False,
    target_athlete_id: str | None = None,
) -> ImportRunStatus:
    """Create a run, launch the background worker and return the initial status.

    The caller must already hold ``_import_lock`` (acquired non-blocking); the
    background job releases it. On failure to launch we release it here.
    """
    run = ImportRun(source=str(getattr(source, "name", source)), status="running")
    db.add(run)
    db.commit()
    run_id = run.id

    try:
        threading.Thread(
            target=_run_import_job,
            args=(
                source,
                provider,
                run_id,
                cleanup_path,
                force,
                target_athlete_id,
            ),
            daemon=True,
        ).start()
    except Exception:
        _import_lock.release()
        raise
    return _run_status(run)


@router.post("", response_model=ImportRunStatus)
def run_import(payload: ImportRequest, db: Session = Depends(get_db)) -> ImportRunStatus:
    if not _import_lock.acquire(blocking=False):
        raise HTTPException(status_code=409, detail="An import is already running.")
    try:
        return _start_import(
            db,
            payload.source,
            provider=payload.provider,
            cleanup_path=None,
            force=payload.force,
            target_athlete_id=payload.athlete_id,
        )
    except Exception as exc:
        logger.exception("Failed to start import")
        raise HTTPException(status_code=500, detail=f"Failed to start import: {exc}") from None


@router.post("/upload", response_model=ImportRunStatus)
def upload_import(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
) -> ImportRunStatus:
    """Accept a Strava/Garmin export ``.zip``, store it and import in background."""
    target = _store_upload(file)

    if not _import_lock.acquire(blocking=False):
        target.unlink(missing_ok=True)
        raise HTTPException(status_code=409, detail="An import is already running.")

    try:
        return _start_import(db, target, provider=None, cleanup_path=target)
    except Exception as exc:
        target.unlink(missing_ok=True)
        logger.exception("Failed to start import for uploaded file")
        raise HTTPException(status_code=500, detail=f"Failed to start import: {exc}") from None


def _store_upload(file: UploadFile) -> Path:
    """Stream an uploaded ``.zip`` to the uploads directory and return its path."""
    filename = file.filename or "export.zip"
    suffix = Path(filename).suffix.lower()
    if suffix not in _ALLOWED_UPLOAD_SUFFIXES:
        raise HTTPException(status_code=400, detail="Only .zip export archives are supported.")

    uploads_dir = settings.storage_dir / "uploads"
    uploads_dir.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.utcnow().strftime("%Y%m%d-%H%M%S")
    target = uploads_dir / f"{timestamp}-{Path(filename).name}"

    size = 0
    try:
        with target.open("wb") as out:
            while chunk := file.file.read(1024 * 1024):
                size += len(chunk)
                if size > MAX_UPLOAD_BYTES:
                    target.unlink(missing_ok=True)
                    raise HTTPException(status_code=413, detail="Upload too large.")
                out.write(chunk)
    finally:
        file.file.close()
    return target


def _profile_name(profile: AthleteProfileRow | AthleteProfile | None) -> str | None:
    if profile is None:
        return None
    name = " ".join(p for p in (profile.first_name, profile.last_name) if p)
    return name or None


def _normalize_name(name: str | None) -> str:
    return " ".join((name or "").lower().split())


def _suggest_target(
    db: Session, provider: str, source_athlete_id: str | None, name: str | None
) -> tuple[str | None, str | None]:
    """Suggest a merge target: a remembered mapping, else a unique name match."""
    # A previous merge wins: reuse the canonical athlete this account mapped to.
    if source_athlete_id:
        mapping = db.get(SourceIdentity, (provider, source_athlete_id))
        if mapping is not None and mapping.athlete_id != source_athlete_id:
            target = db.get(AthleteProfile, mapping.athlete_id)
            if target is not None:
                return target.athlete_id, _profile_name(target)

    # Otherwise suggest an existing athlete whose name matches exactly one.
    norm = _normalize_name(name)
    if norm:
        profiles = db.execute(select(AthleteProfile)).scalars().all()
        matches = [
            p
            for p in profiles
            if p.athlete_id != source_athlete_id and _normalize_name(_profile_name(p)) == norm
        ]
        if len(matches) == 1:
            return matches[0].athlete_id, _profile_name(matches[0])
    return None, None


def _build_preview(db: Session, source: str) -> ImportPreview:
    """Inspect an export (provider, athlete, count) without importing it."""
    if is_garmin_export(source):
        reader: ExportReader | GarminExportReader = GarminExportReader(source)
        provider = "garmin"
    else:
        reader = ExportReader(source)
        provider = "strava"

    with reader:
        profile = reader.read_profile()
        count = reader.count_activities()

    source_athlete_id = profile.athlete_id if profile else None
    name = _profile_name(profile)
    is_existing = (
        source_athlete_id is not None and db.get(AthleteProfile, source_athlete_id) is not None
    )
    suggested_id, suggested_name = _suggest_target(db, provider, source_athlete_id, name)
    return ImportPreview(
        source=source,
        provider=provider,
        athlete_name=name,
        source_athlete_id=source_athlete_id,
        activity_count=count,
        is_existing_athlete=is_existing,
        suggested_athlete_id=suggested_id,
        suggested_athlete_name=suggested_name,
    )


@router.post("/preview", response_model=ImportPreview)
def preview_import(
    file: UploadFile | None = File(default=None),
    source: str | None = Form(default=None),
    db: Session = Depends(get_db),
) -> ImportPreview:
    """Inspect an export before importing so the user can choose the athlete.

    Accepts either an uploaded ``.zip`` (stored server-side and returned as the
    ``source`` token to import next) or a server ``source`` path.
    """
    stored: Path | None = None
    if file is not None:
        stored = _store_upload(file)
        path = str(stored)
    elif source:
        path = source
    else:
        raise HTTPException(status_code=400, detail="Provide a file or a source path.")

    try:
        return _build_preview(db, path)
    except HTTPException:
        raise
    except Exception as exc:
        if stored is not None:
            stored.unlink(missing_ok=True)
        logger.exception("Import preview failed")
        raise HTTPException(status_code=400, detail=f"Could not read export: {exc}") from None


@router.get("/runs/{run_id}", response_model=ImportRunStatus)
def get_import_run(run_id: int, db: Session = Depends(get_db)) -> ImportRunStatus:
    run = db.get(ImportRun, run_id)
    if run is None:
        raise HTTPException(status_code=404, detail="Import run not found.")
    return _run_status(run)


@router.get("/runs")
def list_import_runs(db: Session = Depends(get_db), limit: int = 20) -> list[dict]:
    stmt = select(ImportRun).order_by(ImportRun.started_at.desc()).limit(limit)
    runs = db.execute(stmt).scalars().all()
    return [
        {
            "id": run.id,
            "started_at": run.started_at,
            "finished_at": run.finished_at,
            "source": run.source,
            "status": run.status,
            "activities_added": run.activities_added,
            "activities_updated": run.activities_updated,
            "activities_skipped": run.activities_skipped,
            "gear_upserted": run.gear_upserted,
        }
        for run in runs
    ]

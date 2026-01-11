from __future__ import annotations

import threading
from datetime import datetime
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import settings
from app.db import SessionLocal, get_db
from app.ingestion.importer import import_export
from app.models import ImportRun
from app.schemas import ImportRequest

router = APIRouter(prefix="/api/import", tags=["import"])

# Only allow archive/zip uploads; activity files live inside the export zip.
_ALLOWED_UPLOAD_SUFFIXES = {".zip"}
# Guard against unbounded uploads (default 500 MB).
MAX_UPLOAD_BYTES = 500 * 1024 * 1024

_import_lock = threading.Lock()


def _run_import_in_background(source: str | Path, *, force: bool = False) -> None:
    db = SessionLocal()
    try:
        import_export(db, source, force=force)
    except Exception:
        import logging

        logging.getLogger("strastat.import").exception("Background import failed")
    finally:
        db.close()


@router.post("")
def run_import(payload: ImportRequest, db: Session = Depends(get_db)) -> dict:
    if not _import_lock.acquire(blocking=False):
        raise HTTPException(status_code=409, detail="An import is already running.")
    try:
        thread = threading.Thread(
            target=_background_import_wrapper,
            args=(payload.source,),
            kwargs={"force": payload.force},
            daemon=True,
        )
        thread.start()
    except Exception:
        _import_lock.release()
        raise
    return {"status": "started", "message": "Import running in the background."}


@router.post("/upload")
def upload_import(
    file: UploadFile = File(...),
) -> dict:
    """Accept a Strava export ``.zip`` upload, store it and import in the background."""
    filename = file.filename or "export.zip"
    suffix = Path(filename).suffix.lower()
    if suffix not in _ALLOWED_UPLOAD_SUFFIXES:
        raise HTTPException(
            status_code=400, detail="Only .zip Strava export archives are supported."
        )

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
                    raise HTTPException(status_code=413, detail="Upload too large.")
                out.write(chunk)
    finally:
        file.file.close()

    if not _import_lock.acquire(blocking=False):
        target.unlink(missing_ok=True)
        raise HTTPException(status_code=409, detail="An import is already running.")

    try:
        thread = threading.Thread(target=_background_import_wrapper, args=(target,), daemon=True)
        thread.start()
    except Exception:
        _import_lock.release()
        target.unlink(missing_ok=True)
        raise

    return {"status": "started", "message": "Import running in the background."}


def _background_import_wrapper(source: str | Path, *, force: bool = False) -> None:
    try:
        _run_import_in_background(source, force=force)
    finally:
        _import_lock.release()


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

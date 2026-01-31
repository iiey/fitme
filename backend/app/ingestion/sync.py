"""Continuous, incremental activity sync from Intervals.icu.

A single :func:`sync` operation pulls activities at and after the point existing
data ends, reconciles each against what is already stored, and advances a
persisted watermark. It reuses the authoritative upsert path
(:mod:`app.ingestion.upsert`) so a synced activity is stored, fingerprinted and
de-duplicated exactly like the same workout arriving in a bulk export.

Correctness rests on two guards that hold regardless of the order in which bulk
imports and syncs are interleaved, provided everything is bound to the same
canonical athlete:

* **Within Intervals.icu** - re-fetching an activity upserts on its stable
  primary key (``intervals:<id>``), updating in place instead of duplicating.
* **Across providers** - a synced activity that is the same workout as an
  existing Garmin/Strava row is collapsed by cross-source de-duplication before
  insert.

The watermark is Intervals.icu-scoped and advances to the newest activity start
*seen* in a run - inserted, updated or de-duplicated away - so a window in which
everything was already a duplicate still moves forward instead of stalling.
"""

from __future__ import annotations

import json
import logging
from collections import defaultdict
from dataclasses import asdict, dataclass
from datetime import datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.domain.dedup import compute_dedup_key
from app.ingestion.fit import parse_fit
from app.ingestion.gpx import parse_gpx
from app.ingestion.intervals import IntervalsClient, import_source_for
from app.ingestion.parsed import ParsedActivityFile
from app.ingestion.tcx import parse_tcx
from app.ingestion.upsert import (
    canonical_metrics,
    find_cross_source_twin,
    row_hash,
    upsert_activity,
)
from app.models import Activity, SourceIdentity, SyncConfig

logger = logging.getLogger("fitme.sync")

PROVIDER = "intervals"
# Trailing overlap re-scanned each run so late-arriving or edited activities are
# not missed by a forward-only watermark.
OVERLAP_DAYS = 7
# Window used on the very first sync when the athlete has no activities yet.
DEFAULT_LOOKBACK_DAYS = 90
# Commit progress periodically so a long first sync appears incrementally and a
# crash leaves committed activities behind (the un-advanced watermark re-scans).
_COMMIT_EVERY = 25

_PARSERS = {"fit": parse_fit, "gpx": parse_gpx, "tcx": parse_tcx}


@dataclass
class SyncSummary:
    listed: int = 0
    added: int = 0
    updated: int = 0
    skipped: int = 0
    # Same workout already present from another provider - collapsed, not added.
    deduped: int = 0
    # New/changed activities for which detailed streams were obtained.
    enriched: int = 0

    def as_dict(self) -> dict:
        return asdict(self)


def sync(
    db: Session,
    config: SyncConfig,
    *,
    client: IntervalsClient | None = None,
    full_resync: bool = False,
) -> SyncSummary:
    """Run one sync for ``config``, recording run state on the config row.

    A ``full_resync`` ignores the watermark and re-scans from the athlete's
    earliest anchor, for occasional backfills. The supplied ``client`` (or one
    built from the config when omitted) is only read from.
    """
    owns_client = client is None
    if client is None:
        client = IntervalsClient(config.api_key, config.icu_athlete_id)
    try:
        summary = _run_sync(db, config, client, full_resync=full_resync)
        config.last_run_at = datetime.utcnow()
        config.last_status = "ok"
        config.last_message = json.dumps(summary.as_dict())
        db.add(config)
        db.commit()
        return summary
    except Exception as exc:
        _mark_failed(db, config, exc)
        raise
    finally:
        if owns_client:
            client.close()


def _run_sync(
    db: Session,
    config: SyncConfig,
    client: IntervalsClient,
    *,
    full_resync: bool,
) -> SyncSummary:
    summary = SyncSummary()
    athlete_id = config.athlete_id
    _ensure_source_identity(db, config)

    oldest, newest = _resolve_range(db, config, full_resync=full_resync)
    activities = client.list_activities(oldest, newest)
    summary.listed = len(activities)

    athlete_activities = list(
        db.execute(select(Activity).where(Activity.athlete_id == athlete_id)).scalars().all()
    )
    existing = {(a.source, a.external_id): a for a in athlete_activities}
    dedup_index = {a.dedup_key: a for a in athlete_activities if a.dedup_key}
    existing_by_type: dict[str, list[Activity]] = defaultdict(list)
    for activity in athlete_activities:
        existing_by_type[activity.activity_type].append(activity)

    watermark = config.synced_through
    processed = 0
    for item in activities:
        row = item.row
        source_hash = row_hash(row)
        current = existing.get((PROVIDER, row.activity_id))

        # The watermark advances on every activity seen - inserted, updated,
        # skipped or de-duplicated - so an all-duplicate window still moves on.
        start_local = row.parsed_date()
        if start_local is not None and (watermark is None or start_local > watermark):
            watermark = start_local

        if current is not None and current.source_hash == source_hash and not full_resync:
            summary.skipped += 1
            continue

        # Cheap summary-only metrics are enough to spot a cross-source twin and
        # avoid downloading detail for an activity that will be de-duplicated.
        summary_metrics = canonical_metrics(row, None)
        if current is None:
            twin_key = compute_dedup_key(
                summary_metrics.sport.activity_type.value,
                summary_metrics.start_utc,
                summary_metrics.distance_m,
                summary_metrics.moving_s,
            )
            twin = find_cross_source_twin(
                PROVIDER, summary_metrics, twin_key, dedup_index, existing_by_type
            )
            if twin is not None:
                summary.deduped += 1
                continue

        parsed = _fetch_detail(
            client, row.activity_id, item.file_type, summary_metrics.start_utc, start_local
        )
        if parsed is not None:
            summary.enriched += 1

        canonical = canonical_metrics(row, parsed)
        dedup_key = compute_dedup_key(
            canonical.sport.activity_type.value,
            canonical.start_utc,
            canonical.distance_m,
            canonical.moving_s,
        )
        activity = upsert_activity(
            db,
            row,
            parsed,
            source_hash,
            current,
            athlete_id,
            provider=PROVIDER,
            external_id=row.activity_id,
            dedup_key=dedup_key,
            canonical=canonical,
            import_source=import_source_for(item.origin),
        )
        if current is None:
            summary.added += 1
            existing[(PROVIDER, row.activity_id)] = activity
            if dedup_key is not None:
                dedup_index.setdefault(dedup_key, activity)
            existing_by_type[activity.activity_type].append(activity)
        else:
            summary.updated += 1

        processed += 1
        if processed % _COMMIT_EVERY == 0:
            db.commit()

    if watermark is not None:
        config.synced_through = watermark
    return summary


def _resolve_range(
    db: Session, config: SyncConfig, *, full_resync: bool
) -> tuple[datetime, datetime]:
    """Resolve the inclusive ``(oldest, newest)`` local-date range to fetch.

    Returned as datetimes; the client formats them as ISO dates. ``newest`` runs
    a day past now so activities recorded today are always in range.
    """
    now = datetime.utcnow()
    newest = now + timedelta(days=1)
    if not full_resync and config.synced_through is not None:
        anchor = config.synced_through
    else:
        anchor = _newest_existing_start(db, config.athlete_id) or (
            now - timedelta(days=DEFAULT_LOOKBACK_DAYS)
        )
    oldest = anchor - timedelta(days=OVERLAP_DAYS)
    return oldest, newest


def _newest_existing_start(db: Session, athlete_id: str) -> datetime | None:
    """The newest activity start for the athlete across all sources, or None."""
    return db.execute(
        select(func.max(Activity.start_date_time)).where(Activity.athlete_id == athlete_id)
    ).scalar()


def _fetch_detail(
    client: IntervalsClient,
    activity_id: str,
    file_type: str | None,
    start_utc: datetime | None,
    start_local: datetime | None,
) -> ParsedActivityFile | None:
    """Hybrid detail fetch: original file via the parser, else the streams API.

    Strava-origin activities have neither, so ``None`` is returned and only the
    summary is stored.
    """
    original = client.download_original(activity_id, file_type)
    if original is not None:
        data, ext = original
        parsed = _parse_file_bytes(data, ext)
        if parsed is not None:
            if parsed.start_time is None:
                parsed.start_time = start_utc
            if parsed.start_time_local is None:
                parsed.start_time_local = start_local
            return parsed
    return client.get_streams(activity_id, start_utc=start_utc, start_local=start_local)


def _parse_file_bytes(data: bytes, ext: str) -> ParsedActivityFile | None:
    parser = _PARSERS.get(ext)
    if parser is None:
        return None
    try:
        return parser(data)
    except Exception:  # noqa: BLE001 - a bad file falls back to the streams API.
        logger.warning("Failed to parse downloaded %s file", ext, exc_info=True)
        return None


def _ensure_source_identity(db: Session, config: SyncConfig) -> None:
    """Record ``(intervals, icu_athlete_id) -> athlete_id`` for identity linkage."""
    mapping = db.get(SourceIdentity, (PROVIDER, config.icu_athlete_id)) or SourceIdentity(
        source=PROVIDER, source_athlete_id=config.icu_athlete_id
    )
    mapping.athlete_id = config.athlete_id
    db.add(mapping)


def _mark_failed(db: Session, config: SyncConfig, exc: Exception) -> None:
    """Record a sync failure on the config row without masking ``exc``."""
    logger.exception("Sync failed")
    try:
        db.rollback()
        config = db.get(SyncConfig, config.provider) or config
        config.last_run_at = datetime.utcnow()
        config.last_status = "error"
        config.last_message = json.dumps({"error": str(exc)})
        db.add(config)
        db.commit()
    except Exception:  # noqa: BLE001 - never replace the original failure.
        db.rollback()

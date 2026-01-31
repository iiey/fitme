from __future__ import annotations

import json
import logging
from collections import defaultdict
from dataclasses import asdict, dataclass
from datetime import datetime
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.domain.dedup import compute_dedup_key
from app.enums import SportType
from app.ingestion.export import CsvActivityRow, ExportReader
from app.ingestion.garmin import GarminExportReader, is_garmin_export
from app.ingestion.parallel import FileParser
from app.ingestion.parsed import ParsedActivityFile
from app.ingestion.upsert import (
    canonical_metrics,
    find_cross_source_twin,
    gear_slug,
    row_hash,
    upsert_activity,
)
from app.models import (
    Activity,
    AthleteProfile,
    Gear,
    ImportRun,
    SourceIdentity,
)

logger = logging.getLogger("fitme.import")

# A reader over a bulk export: the Strava CSV reader or the Garmin summary
# reader. Both expose ``read_activity_rows`` / ``read_profile`` /
# ``read_activity_file`` plus context-manager support.
_Reader = ExportReader | GarminExportReader

# Activity files are parsed a batch at a time so memory stays bounded and
# progress can be committed incrementally. A parallel worker pool is only used
# when at least this many files need parsing (small imports stay serial).
_PARSE_BATCH = 24
_PARALLEL_MIN_FILES = 16


@dataclass
class ImportSummary:
    added: int = 0
    updated: int = 0
    skipped: int = 0
    # Rows recognised as the same physical activity already imported from
    # another provider, and therefore skipped instead of duplicated.
    deduped: int = 0
    gear_upserted: int = 0
    files_parsed: int = 0
    parse_errors: int = 0

    def as_dict(self) -> dict:
        return asdict(self)


def _open_reader(source: str | Path) -> tuple[_Reader, str]:
    """Pick the reader for ``source``, returning ``(reader, provider)``.

    Garmin bulk exports have no ``activities.csv``; they are detected by their
    ``DI_CONNECT`` layout / ``summarizedActivities.json`` and read by the
    summary-driven :class:`GarminExportReader`. Everything else is treated as a
    Strava export.
    """
    if is_garmin_export(source):
        return GarminExportReader(source), "garmin"
    return ExportReader(source), "strava"


def import_export(
    db: Session,
    source: str | Path,
    *,
    provider: str | None = None,
    force: bool = False,
    run_id: int | None = None,
    target_athlete_id: str | None = None,
) -> ImportSummary:
    """Import (or re-import) a bulk export, idempotently and source-aware.

    Each activity is identified by ``(provider, external_id)`` - the provider's
    native id. Unchanged rows are skipped (no file re-parse), changed rows are
    updated, new rows are inserted.

    Before a brand-new activity is inserted, its content fingerprint
    (``dedup_key``) is compared against activities already imported from *other*
    providers. A match means the same physical workout is already present, so
    the row is skipped instead of creating a duplicate (e.g. the same ride
    imported from both a Strava and a Garmin export).

    Activity files (FIT/GPX/TCX) are parsed a batch at a time, in parallel when
    there are enough of them to justify a worker pool, and progress is committed
    after every batch. This bounds memory, lets the data appear incrementally,
    and keeps large Garmin imports fast. When ``run_id`` is given the matching
    :class:`ImportRun` is updated in place (used by background imports); the
    run's ``status``/counts are maintained here through to completion or error.

    ``target_athlete_id`` merges the import into an existing athlete instead of
    the provider's own account: all activities are stored under that athlete
    (so cross-source de-duplication collapses workouts shared with another
    provider), and the provider-identity → athlete mapping is remembered so
    later imports of the same account resolve there automatically.
    """
    summary = ImportSummary()
    run = _resolve_run(db, run_id, source)

    gear_accumulator: dict[str, dict] = {}
    reader, detected_provider = _open_reader(source)
    # Detection picks the reader; an explicit ``provider`` only overrides the
    # stored label and otherwise defaults to the detected source.
    provider = provider or detected_provider

    try:
        with reader:
            athlete_id = _resolve_athlete(
                db, reader, provider=provider, target_athlete_id=target_athlete_id
            )
            run.athlete_id = athlete_id

            rows = reader.read_activity_rows()
            athlete_activities = list(
                db.execute(select(Activity).where(Activity.athlete_id == athlete_id))
                .scalars()
                .all()
            )
            # Identity map keyed on the provider's native id, plus a content
            # index used to spot the same workout arriving from another provider.
            existing = {(a.source, a.external_id): a for a in athlete_activities}
            dedup_index = {a.dedup_key: a for a in athlete_activities if a.dedup_key}
            # Candidates for the tolerant cross-source match, grouped by broad
            # sport so only plausible twins are compared.
            existing_by_type: dict[str, list[Activity]] = defaultdict(list)
            for a in athlete_activities:
                existing_by_type[a.activity_type].append(a)

            # First pass: accumulate gear, skip unchanged rows, queue the rest.
            work: list[tuple[CsvActivityRow, Activity | None, str]] = []
            for row in rows:
                _accumulate_gear(gear_accumulator, row, athlete_id)
                source_hash = row_hash(row)
                current = existing.get((provider, row.activity_id))
                if current is not None and current.source_hash == source_hash and not force:
                    summary.skipped += 1
                    continue
                work.append((row, current, source_hash))

            total = len(work)
            _update_run(run, summary, processed=0, total=total)
            db.commit()

            files_to_parse = sum(1 for row, _, _ in work if row.filename)
            processed = 0
            with FileParser(enabled=files_to_parse >= _PARALLEL_MIN_FILES) as parser:
                for batch in _chunked(work, _PARSE_BATCH):
                    parsed_map = _parse_batch_files(reader, parser, batch, summary)
                    for row, current, source_hash in batch:
                        parsed = parsed_map.get(row.filename) if row.filename else None
                        canonical = canonical_metrics(row, parsed)
                        dedup_key = compute_dedup_key(
                            canonical.sport.activity_type.value,
                            canonical.start_utc,
                            canonical.distance_m,
                            canonical.moving_s,
                        )

                        # The same workout already imported from a different
                        # provider (exact fingerprint, else a tolerant match): skip.
                        if current is None:
                            twin = find_cross_source_twin(
                                provider,
                                canonical,
                                dedup_key,
                                dedup_index,
                                existing_by_type,
                            )
                            if twin is not None:
                                summary.deduped += 1
                                continue

                        activity = upsert_activity(
                            db,
                            row,
                            parsed,
                            source_hash,
                            current,
                            athlete_id,
                            provider=provider,
                            external_id=row.activity_id,
                            dedup_key=dedup_key,
                            canonical=canonical,
                        )
                        if current is None:
                            summary.added += 1
                            existing[(provider, row.activity_id)] = activity
                            if dedup_key is not None:
                                dedup_index.setdefault(dedup_key, activity)
                        else:
                            summary.updated += 1

                    processed += len(batch)
                    _update_run(run, summary, processed=processed, total=total)
                    db.commit()

            summary.gear_upserted = _upsert_gear(db, gear_accumulator)
            run.finished_at = datetime.utcnow()
            run.status = "ok"
            _update_run(run, summary, processed=total, total=total)
            db.commit()
    except Exception as exc:
        _mark_run_failed(db, run, exc)
        raise

    return summary


def _resolve_run(db: Session, run_id: int | None, source: str | Path) -> ImportRun:
    """Load the pre-created run (background import) or start a fresh one."""
    if run_id is not None:
        run = db.get(ImportRun, run_id)
        if run is not None:
            return run
    run = ImportRun(source=str(source), status="running")
    db.add(run)
    db.flush()
    return run


def _chunked(items: list, size: int):
    for start in range(0, len(items), size):
        yield items[start : start + size]


def _update_run(run: ImportRun, summary: ImportSummary, *, processed: int, total: int) -> None:
    """Mirror the running summary onto the import-run row (counts + progress)."""
    run.activities_added = summary.added
    run.activities_updated = summary.updated
    run.activities_skipped = summary.skipped
    run.gear_upserted = summary.gear_upserted
    run.message = json.dumps({**summary.as_dict(), "total": total, "processed": processed})


def _mark_run_failed(db: Session, run: ImportRun, exc: Exception) -> None:
    """Record an import failure on the run row without masking ``exc``."""
    logger.exception("Import failed")
    try:
        db.rollback()
        if run.id is not None:
            run = db.get(ImportRun, run.id) or run
        run.status = "error"
        run.finished_at = datetime.utcnow()
        run.message = json.dumps({"error": str(exc)})
        db.add(run)
        db.commit()
    except Exception:  # noqa: BLE001 - never replace the original failure.
        db.rollback()


def _parse_batch_files(
    reader: _Reader,
    parser: FileParser,
    batch: list[tuple[CsvActivityRow, Activity | None, str]],
    summary: ImportSummary,
) -> dict[str, ParsedActivityFile]:
    """Read and parse the activity files referenced by a batch of rows."""
    items: list[tuple[str, bytes, str]] = []
    for row, _current, _hash in batch:
        if not row.filename:
            continue
        try:
            file_result = reader.read_activity_file(row.filename)
        except Exception as exc:  # noqa: BLE001 - tolerate unreadable files.
            summary.parse_errors += 1
            logger.warning("Failed to read %s: %s", row.filename, exc)
            continue
        if file_result is not None:
            data, ext = file_result
            items.append((row.filename, data, ext))

    parsed_map: dict[str, ParsedActivityFile] = {}
    for key, parsed, error in parser.parse_batch(items):
        if error:
            summary.parse_errors += 1
        elif parsed is not None:
            parsed_map[key] = parsed
            summary.files_parsed += 1
    return parsed_map


def _accumulate_gear(acc: dict[str, dict], row: CsvActivityRow, athlete_id: str) -> None:
    if not row.gear_name:
        return
    slug = gear_slug(row.gear_name, athlete_id)
    entry = acc.setdefault(
        slug,
        {
            "name": row.gear_name,
            "distance_m": 0.0,
            "run_walk": 0,
            "ride": 0,
            "athlete_id": athlete_id,
        },
    )
    entry["distance_m"] += row.distance_m or 0.0
    sport = SportType.from_strava(row.sport_type_raw)
    if sport.activity_type.value in ("Run", "Walk"):
        entry["run_walk"] += 1
    else:
        entry["ride"] += 1


def _upsert_gear(db: Session, acc: dict[str, dict]) -> int:
    count = 0
    for slug, entry in acc.items():
        gear = db.get(Gear, slug) or Gear(gear_id=slug, athlete_id=entry["athlete_id"])
        gear.athlete_id = entry["athlete_id"]
        gear.name = entry["name"]
        gear.distance_m = entry["distance_m"]
        gear.gear_type = "shoe" if entry["run_walk"] > entry["ride"] else "bike"
        db.add(gear)
        count += 1
    return count


def _resolve_athlete(
    db: Session,
    reader: _Reader,
    *,
    provider: str,
    target_athlete_id: str | None,
) -> str:
    """Resolve the canonical ``athlete_id`` for this import and store the mapping.

    Resolution order:

    1. **Explicit target** (the user chose "merge into X" or "new athlete") -
       use it and (re)record the ``(provider, source_athlete_id) -> target``
       mapping so the decision sticks. The target's own profile is only created
       when it does not exist yet; an existing athlete's profile is never
       overwritten by the incoming provider's profile.
    2. **Sticky mapping** from a previous merge - reuse the canonical athlete the
       provider account was last mapped to.
    3. **New athlete** - the provider's own id becomes the athlete; its profile
       and a self-mapping are created.
    """
    profile_row = _read_profile_safe(reader)
    source_athlete_id = profile_row.athlete_id if profile_row else None

    # 1. Explicit user choice.
    if target_athlete_id:
        if source_athlete_id:
            _upsert_source_identity(db, provider, source_athlete_id, target_athlete_id)
        target_exists = db.get(AthleteProfile, target_athlete_id) is not None
        # Adopt the provider's profile only when keeping its own id ("new"), or
        # to seed a missing target; never overwrite an existing athlete's profile.
        if target_athlete_id == source_athlete_id or not target_exists:
            _upsert_profile(db, target_athlete_id, profile_row)
        return target_athlete_id

    # 2. Remembered mapping from an earlier merge.
    if source_athlete_id:
        mapping = db.get(SourceIdentity, (provider, source_athlete_id))
        if mapping is not None:
            if mapping.athlete_id == source_athlete_id:
                _upsert_profile(db, source_athlete_id, profile_row)
            return mapping.athlete_id

    # 3. No profile in the export: keep the historical behaviour of storing
    #    activities under athlete "1" without creating a profile row.
    if source_athlete_id is None:
        return "1"

    # 4. Brand-new athlete keyed on the provider's own id.
    _upsert_profile(db, source_athlete_id, profile_row)
    _upsert_source_identity(db, provider, source_athlete_id, source_athlete_id)
    return source_athlete_id


def _read_profile_safe(reader: _Reader):
    """Read the export's athlete profile, tolerating a malformed/absent one."""
    try:
        return reader.read_profile()
    except Exception as exc:  # noqa: BLE001 - a bad profile must not abort import.
        logger.warning("Failed to parse athlete profile: %s", exc)
        return None


def _upsert_profile(db: Session, athlete_id: str, profile_row) -> None:
    """Create or update an athlete profile from the parsed export profile."""
    profile = db.get(AthleteProfile, athlete_id) or AthleteProfile(athlete_id=athlete_id)
    if profile_row is not None:
        profile.first_name = profile_row.first_name
        profile.last_name = profile_row.last_name
        profile.city = profile_row.city
        profile.state = profile_row.state
        profile.country = profile_row.country
        profile.sex = profile_row.sex
    db.add(profile)


def _upsert_source_identity(
    db: Session, source: str, source_athlete_id: str, athlete_id: str
) -> None:
    """Record/refresh the ``(source, source_athlete_id) -> athlete_id`` mapping."""
    mapping = db.get(SourceIdentity, (source, source_athlete_id)) or SourceIdentity(
        source=source, source_athlete_id=source_athlete_id
    )
    mapping.athlete_id = athlete_id
    db.add(mapping)

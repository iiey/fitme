from __future__ import annotations

import hashlib
import json
import logging
from collections import defaultdict
from dataclasses import asdict, dataclass
from datetime import datetime
from pathlib import Path

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.domain.best_efforts import compute_best_efforts
from app.domain.dedup import activities_match, compute_dedup_key
from app.enums import SportType, StreamType
from app.ingestion import polyline as polyline_codec
from app.ingestion.export import CsvActivityRow, ExportReader
from app.ingestion.garmin import GarminExportReader, is_garmin_export
from app.ingestion.parallel import FileParser
from app.ingestion.parsed import (
    ParsedActivityFile,
    StreamSummary,
    summarize_streams,
)
from app.models import (
    Activity,
    ActivityStream,
    AthleteProfile,
    BestEffort,
    Gear,
    ImportRun,
    SourceIdentity,
)

logger = logging.getLogger("fitme.import")

# A reader over a bulk export: the Strava CSV reader or the Garmin summary
# reader. Both expose ``read_activity_rows`` / ``read_profile`` /
# ``read_activity_file`` plus context-manager support.
_Reader = ExportReader | GarminExportReader

# Bound the number of stored stream samples and polyline points per activity.
MAX_STREAM_SAMPLES = 2000
MAX_POLYLINE_POINTS = 1000
# Streams worth persisting for activity-detail charts and the heatmap.
_PERSISTED_STREAMS = [
    StreamType.TIME,
    StreamType.DISTANCE,
    StreamType.ALTITUDE,
    StreamType.VELOCITY,
    StreamType.HEART_RATE,
    StreamType.CADENCE,
    StreamType.WATTS,
]

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


def _row_hash(row: CsvActivityRow) -> str:
    payload = json.dumps(row.raw, sort_keys=True, default=str)
    return hashlib.sha1(payload.encode("utf-8")).hexdigest()


def _merge(csv_value, stream_value):
    """Prefer the CSV value, falling back to the value derived from streams."""
    return csv_value if csv_value is not None else stream_value


def _downsample(values: list, max_points: int) -> list:
    if len(values) <= max_points:
        return values
    step = len(values) / max_points
    return [values[int(i * step)] for i in range(max_points)]


def _build_polyline(parsed: ParsedActivityFile) -> str | None:
    coords = parsed.latlng()
    if len(coords) < 2:
        return None
    coords = polyline_codec.simplify_to_limit(coords, MAX_POLYLINE_POINTS)
    return polyline_codec.encode(coords)


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


def _find_cross_source_twin(
    provider: str,
    canonical: _Canonical,
    dedup_key: str | None,
    dedup_index: dict[str, Activity],
    existing_by_type: dict[str, list[Activity]],
) -> Activity | None:
    """Return an existing activity from another provider that is the same workout.

    Tries the exact content fingerprint first (fast path for activities synced
    verbatim between providers), then falls back to a tolerant match on start
    time and distance within the same broad sport - which catches the same
    workout when the providers report a slightly different distance or moving
    time.
    """
    if dedup_key is not None:
        twin = dedup_index.get(dedup_key)
        if twin is not None and twin.source != provider:
            return twin
    for cand in existing_by_type.get(canonical.sport.activity_type.value, ()):
        if cand.source == provider:
            continue
        if activities_match(
            canonical.start_utc,
            canonical.distance_m,
            cand.start_utc or cand.start_date_time,
            cand.distance_m,
        ):
            return cand
    return None


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
                source_hash = _row_hash(row)
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
                        canonical = _canonical_metrics(row, parsed)
                        dedup_key = compute_dedup_key(
                            canonical.sport.activity_type.value,
                            canonical.start_utc,
                            canonical.distance_m,
                            canonical.moving_s,
                        )

                        # The same workout already imported from a different
                        # provider (exact fingerprint, else a tolerant match): skip.
                        if current is None:
                            twin = _find_cross_source_twin(
                                provider,
                                canonical,
                                dedup_key,
                                dedup_index,
                                existing_by_type,
                            )
                            if twin is not None:
                                summary.deduped += 1
                                continue

                        activity = _upsert_activity(
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


def _resolve_sport_type(row: CsvActivityRow, parsed: ParsedActivityFile | None) -> SportType:
    sport = SportType.from_strava(row.sport_type_raw)
    if sport == SportType.WORKOUT and parsed and parsed.sport_type:
        sport = SportType.from_strava(parsed.sport_type)
    return sport


@dataclass
class _Canonical:
    """Merged, canonical metrics for an activity (CSV values preferred)."""

    sport: SportType
    start_dt: datetime
    start_utc: datetime
    distance_m: float
    elevation_m: float
    moving_s: int
    elapsed_s: int
    summary: StreamSummary | None


def _canonical_metrics(row: CsvActivityRow, parsed: ParsedActivityFile | None) -> _Canonical:
    """Resolve the activity's defining metrics once, for upsert and dedup."""
    summary = summarize_streams(parsed) if parsed else None
    sport = _resolve_sport_type(row, parsed)

    # Prefer the file's local wall-clock start (FIT timezone offset) so weekday
    # and time-of-day breakdowns reflect the athlete's local time. The Strava
    # CSV "Activity Date" is UTC, so it is only a fallback.
    start_dt = (
        (parsed.start_time_local if parsed else None)
        or row.parsed_date()
        or (parsed.start_time if parsed else None)
        or datetime.utcnow()
    )

    # A stable UTC start drives cross-source de-duplication: a recorded file's
    # ``start_time`` is UTC for every format, and the provider summary carries an
    # explicit UTC start (Garmin ``startTimeGmt`` / Strava's UTC CSV date).
    start_utc = (parsed.start_time if parsed else None) or row.start_utc or start_dt

    distance_m = _merge(row.distance_m, summary.distance_m if summary else None) or 0.0
    elevation_m = _merge(row.elevation_gain_m, summary.elevation_gain_m if summary else None) or 0.0
    moving_s = _merge(row.moving_time_s, summary.moving_time_s if summary else None) or 0
    elapsed_s = _merge(row.elapsed_time_s, summary.elapsed_time_s if summary else None) or moving_s
    return _Canonical(
        sport=sport,
        start_dt=start_dt,
        start_utc=start_utc,
        distance_m=float(distance_m),
        elevation_m=float(elevation_m),
        moving_s=int(moving_s),
        elapsed_s=int(elapsed_s),
        summary=summary,
    )


def _activity_pk(provider: str, external_id: str) -> str:
    """Primary key for an activity.

    Strava ids are kept verbatim for backward compatibility; other providers
    are namespaced so their ids cannot collide with Strava's.
    """
    return external_id if provider == "strava" else f"{provider}:{external_id}"


def _upsert_activity(
    db: Session,
    row: CsvActivityRow,
    parsed: ParsedActivityFile | None,
    source_hash: str,
    current: Activity | None,
    athlete_id: str,
    *,
    provider: str,
    external_id: str,
    dedup_key: str | None,
    canonical: _Canonical,
) -> Activity:
    summary = canonical.summary
    sport = canonical.sport

    # ``current`` is scoped to the target athlete. An activity with this id may
    # still exist under a *different* athlete (re-targeting a provider account to
    # another athlete) - adopt and move it rather than colliding on the PK.
    activity = (
        current
        or db.get(Activity, _activity_pk(provider, external_id))
        or Activity(activity_id=_activity_pk(provider, external_id), athlete_id=athlete_id)
    )
    activity.athlete_id = athlete_id
    activity.source = provider
    activity.external_id = external_id
    activity.dedup_key = dedup_key
    activity.start_date_time = canonical.start_dt
    activity.start_utc = canonical.start_utc
    activity.sport_type = sport.value
    activity.activity_type = sport.activity_type.value
    activity.name = row.name or sport.label
    activity.description = row.description
    activity.distance_m = canonical.distance_m
    activity.elevation_m = canonical.elevation_m
    activity.moving_time_s = canonical.moving_s
    activity.elapsed_time_s = canonical.elapsed_s
    activity.average_speed_ms = _merge(
        row.average_speed_ms, summary.average_speed_ms if summary else None
    )
    activity.max_speed_ms = _merge(row.max_speed_ms, summary.max_speed_ms if summary else None)
    activity.average_heart_rate = _merge(
        row.average_heart_rate, summary.average_heart_rate if summary else None
    )
    activity.max_heart_rate = _merge(
        row.max_heart_rate, summary.max_heart_rate if summary else None
    )
    activity.average_cadence = _merge(
        row.average_cadence, summary.average_cadence if summary else None
    )
    activity.max_cadence = _merge(row.max_cadence, summary.max_cadence if summary else None)
    activity.average_power = _merge(row.average_power, summary.average_power if summary else None)
    activity.max_power = _merge(row.max_power, summary.max_power if summary else None)
    activity.normalized_power = summary.normalized_power if summary else None
    activity.calories = _merge(row.calories, parsed.calories if parsed else None)
    activity.is_commute = row.is_commute
    activity.gear_name = row.gear_name
    activity.gear_id = _gear_slug(row.gear_name, athlete_id) if row.gear_name else None
    activity.import_source = _ext_for_filename(row.filename) if row.filename else "csv"

    if parsed:
        activity.device_name = parsed.device_name
        activity.polyline = _build_polyline(parsed)
        if summary:
            activity.start_latitude = summary.start_latitude
            activity.start_longitude = summary.start_longitude
        activity.streams_are_imported = True
    else:
        activity.streams_are_imported = False

    # Summary-only sources (e.g. the Garmin export) carry these directly on the
    # row because there is no per-activity file to derive them from.
    if activity.start_latitude is None:
        activity.start_latitude = row.start_latitude
    if activity.start_longitude is None:
        activity.start_longitude = row.start_longitude
    if activity.device_name is None:
        activity.device_name = row.device_name
    if activity.normalized_power is None:
        activity.normalized_power = row.normalized_power

    activity.source_hash = source_hash
    db.add(activity)

    # Replace dependent rows (streams + best efforts) for new/changed activities.
    db.execute(delete(ActivityStream).where(ActivityStream.activity_id == activity.activity_id))
    db.execute(delete(BestEffort).where(BestEffort.activity_id == activity.activity_id))

    if parsed:
        _store_streams(db, activity.activity_id, parsed)
        _store_best_efforts(db, activity, parsed, sport)
    return activity


def _store_streams(db: Session, activity_id: str, parsed: ParsedActivityFile) -> None:
    for stream_type in _PERSISTED_STREAMS:
        values = parsed.streams.get(stream_type.value)
        if not values or all(v is None for v in values):
            continue
        db.add(
            ActivityStream(
                activity_id=activity_id,
                stream_type=stream_type.value,
                data=_downsample(values, MAX_STREAM_SAMPLES),
            )
        )


def _store_best_efforts(
    db: Session, activity: Activity, parsed: ParsedActivityFile, sport: SportType
) -> None:
    for distance_m, time_s in compute_best_efforts(parsed.streams, sport):
        db.add(
            BestEffort(
                activity_id=activity.activity_id,
                distance_m=distance_m,
                sport_type=sport.value,
                activity_type=sport.activity_type.value,
                start_date_time=activity.start_date_time,
                time_s=time_s,
            )
        )


def _gear_slug(name: str, athlete_id: str = "") -> str:
    key = f"{athlete_id}:{name.strip().lower()}" if athlete_id else name.strip().lower()
    return "gear-" + hashlib.sha1(key.encode("utf-8")).hexdigest()[:12]


def _ext_for_filename(filename: str) -> str:
    lowered = filename.lower()
    if lowered.endswith(".gz"):
        lowered = lowered[:-3]
    if lowered.endswith(".gpx"):
        return "gpx"
    if lowered.endswith(".tcx"):
        return "tcx"
    if lowered.endswith(".fit"):
        return "fit"
    return "csv"


def _accumulate_gear(acc: dict[str, dict], row: CsvActivityRow, athlete_id: str) -> None:
    if not row.gear_name:
        return
    slug = _gear_slug(row.gear_name, athlete_id)
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

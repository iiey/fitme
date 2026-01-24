from __future__ import annotations

import hashlib
import json
import logging
from dataclasses import asdict, dataclass
from datetime import datetime
from pathlib import Path

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.domain.best_efforts import compute_best_efforts
from app.domain.dedup import compute_dedup_key
from app.enums import SportType, StreamType
from app.ingestion import polyline as polyline_codec
from app.ingestion.export import CsvActivityRow, ExportReader
from app.ingestion.fit import parse_fit
from app.ingestion.gpx import parse_gpx
from app.ingestion.parsed import (
    ParsedActivityFile,
    StreamSummary,
    summarize_streams,
)
from app.ingestion.tcx import parse_tcx
from app.models import (
    Activity,
    ActivityStream,
    AthleteProfile,
    BestEffort,
    Gear,
    ImportRun,
)

logger = logging.getLogger("strastat.import")

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


def _parse_file(data: bytes, ext: str) -> ParsedActivityFile | None:
    if ext == "gpx":
        return parse_gpx(data)
    if ext == "tcx":
        return parse_tcx(data)
    if ext == "fit":
        return parse_fit(data)
    return None


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


def import_export(
    db: Session, source: str | Path, *, provider: str = "strava", force: bool = False
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
    """
    summary = ImportSummary()
    run = ImportRun(source=str(source), status="running")
    db.add(run)
    db.flush()

    gear_accumulator: dict[str, dict] = {}

    with ExportReader(source) as reader:
        athlete_id = _upsert_athlete_profile(db, reader)
        run.athlete_id = athlete_id

        rows = reader.read_activities_csv()
        athlete_activities = list(
            db.execute(select(Activity).where(Activity.athlete_id == athlete_id)).scalars().all()
        )
        # Identity map keyed on the provider's native id, plus a content-based
        # index used to spot the same workout arriving from another provider.
        existing = {(a.source, a.external_id): a for a in athlete_activities}
        dedup_index = {a.dedup_key: a for a in athlete_activities if a.dedup_key}

        for row in rows:
            external_id = row.activity_id
            source_hash = _row_hash(row)
            current = existing.get((provider, external_id))
            unchanged = current is not None and current.source_hash == source_hash

            _accumulate_gear(gear_accumulator, row, athlete_id)

            if unchanged and not force:
                summary.skipped += 1
                continue

            parsed: ParsedActivityFile | None = None
            if row.filename:
                try:
                    file_result = reader.read_activity_file(row.filename)
                    if file_result is not None:
                        data, ext = file_result
                        parsed = _parse_file(data, ext)
                        if parsed is not None:
                            summary.files_parsed += 1
                except Exception as exc:  # noqa: BLE001 - tolerate bad files, keep CSV row.
                    summary.parse_errors += 1
                    logger.warning("Failed to parse %s: %s", row.filename, exc)

            canonical = _canonical_metrics(row, parsed)
            dedup_key = compute_dedup_key(
                canonical.sport.activity_type.value,
                canonical.start_dt,
                canonical.distance_m,
                canonical.moving_s,
            )

            # The same workout already imported from a different provider: skip.
            if current is None and dedup_key is not None:
                twin = dedup_index.get(dedup_key)
                if twin is not None and twin.source != provider:
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
                external_id=external_id,
                dedup_key=dedup_key,
                canonical=canonical,
            )
            if current is None:
                summary.added += 1
                existing[(provider, external_id)] = activity
                if dedup_key is not None:
                    dedup_index.setdefault(dedup_key, activity)
            else:
                summary.updated += 1

    summary.gear_upserted = _upsert_gear(db, gear_accumulator)

    run.finished_at = datetime.utcnow()
    run.status = "ok"
    run.activities_added = summary.added
    run.activities_updated = summary.updated
    run.activities_skipped = summary.skipped
    run.gear_upserted = summary.gear_upserted
    db.commit()
    return summary


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

    distance_m = _merge(row.distance_m, summary.distance_m if summary else None) or 0.0
    elevation_m = _merge(row.elevation_gain_m, summary.elevation_gain_m if summary else None) or 0.0
    moving_s = _merge(row.moving_time_s, summary.moving_time_s if summary else None) or 0
    elapsed_s = _merge(row.elapsed_time_s, summary.elapsed_time_s if summary else None) or moving_s
    return _Canonical(
        sport=sport,
        start_dt=start_dt,
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

    activity = current or Activity(
        activity_id=_activity_pk(provider, external_id), athlete_id=athlete_id
    )
    activity.athlete_id = athlete_id
    activity.source = provider
    activity.external_id = external_id
    activity.dedup_key = dedup_key
    activity.start_date_time = canonical.start_dt
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


def _upsert_athlete_profile(db: Session, reader: ExportReader) -> str:
    """Parse ``profile.csv`` and store the athlete identity. Returns athlete_id."""
    try:
        profile_row = reader.read_profile()
    except Exception as exc:  # noqa: BLE001 - a malformed profile must not abort import.
        logger.warning("Failed to parse profile.csv: %s", exc)
        return "1"
    if profile_row is None:
        return "1"

    athlete_id = profile_row.athlete_id or "1"
    profile = db.get(AthleteProfile, athlete_id) or AthleteProfile(athlete_id=athlete_id)
    profile.first_name = profile_row.first_name
    profile.last_name = profile_row.last_name
    profile.city = profile_row.city
    profile.state = profile_row.state
    profile.country = profile_row.country
    profile.sex = profile_row.sex
    db.add(profile)
    return athlete_id

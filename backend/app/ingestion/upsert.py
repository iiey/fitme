"""Authoritative activity-upsert helpers shared by bulk import and live sync.

Both the bulk-export importer (:mod:`app.ingestion.importer`) and the
Intervals.icu sync engine (:mod:`app.ingestion.sync`) turn a provider's
activity into the same internal :class:`~app.ingestion.export.CsvActivityRow`
and then run it through one code path:

* :func:`row_hash` - a content fingerprint for idempotent re-imports;
* :func:`canonical_metrics` - the activity's defining metrics (CSV value
  preferred, file-derived value as fallback), resolved once for upsert + dedup;
* :func:`find_cross_source_twin` - detect the same physical workout already
  imported from another provider;
* :func:`upsert_activity` - insert/update the row and its streams + best efforts.

Keeping this logic in one module guarantees that an activity synced from
Intervals.icu is stored, fingerprinted and de-duplicated exactly like the same
workout arriving in a Strava or Garmin bulk export.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import delete
from sqlalchemy.orm import Session

from app.domain.best_efforts import compute_best_efforts
from app.domain.dedup import activities_match
from app.enums import SportType, StreamType
from app.ingestion import polyline as polyline_codec
from app.ingestion.export import CsvActivityRow
from app.ingestion.parsed import (
    ParsedActivityFile,
    StreamSummary,
    summarize_streams,
)
from app.models import Activity, ActivityStream, BestEffort

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


def row_hash(row: CsvActivityRow) -> str:
    """Stable content fingerprint of a source row, used to skip unchanged ones.

    The hash is taken over ``row.raw``: the full source record for a bulk-export
    row, or a deliberately *stable subset* for a synced row (so volatile
    computed fields do not mark every activity as changed on each sync).
    """
    payload = json.dumps(row.raw, sort_keys=True, default=str)
    return hashlib.sha1(payload.encode("utf-8")).hexdigest()


def _merge(csv_value, stream_value):
    """Prefer the CSV value, falling back to the value derived from streams."""
    return csv_value if csv_value is not None else stream_value


# A barometric altimeter can spike, making a provider's summary "total ascent"
# read an order of magnitude high (a flat run reporting ~2 km of climb). When we
# have our own stream-derived gain and the provider summary dwarfs it, treat the
# summary as a glitch and trust the stream instead.
_ELEVATION_GLITCH_FACTOR = 3.0
_ELEVATION_GLITCH_MARGIN_M = 50.0


def _merge_elevation(source: float | None, stream_gain: float | None) -> float:
    """Prefer the source summary, unless it is an implausible barometric spike.

    Falls back to the stream-derived gain only when an altitude stream exists and
    the summary both exceeds it by a wide ratio and by a meaningful absolute
    margin, so legitimate climbs (where the two roughly agree) keep the summary.
    """
    if source is None:
        return stream_gain or 0.0
    if stream_gain is None:
        return source
    implausible = (
        source > stream_gain * _ELEVATION_GLITCH_FACTOR
        and source - stream_gain > _ELEVATION_GLITCH_MARGIN_M
    )
    return stream_gain if implausible else source


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


@dataclass
class Canonical:
    """Merged, canonical metrics for an activity (CSV values preferred)."""

    sport: SportType
    start_dt: datetime
    start_utc: datetime
    distance_m: float
    elevation_m: float
    moving_s: int
    elapsed_s: int
    summary: StreamSummary | None


def _resolve_sport_type(row: CsvActivityRow, parsed: ParsedActivityFile | None) -> SportType:
    sport = SportType.from_strava(row.sport_type_raw)
    if sport == SportType.WORKOUT and parsed and parsed.sport_type:
        sport = SportType.from_strava(parsed.sport_type)
    return sport


def canonical_metrics(row: CsvActivityRow, parsed: ParsedActivityFile | None) -> Canonical:
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
    elevation_m = _merge_elevation(
        row.elevation_gain_m, summary.elevation_gain_m if summary else None
    )
    moving_s = _merge(row.moving_time_s, summary.moving_time_s if summary else None) or 0
    elapsed_s = _merge(row.elapsed_time_s, summary.elapsed_time_s if summary else None) or moving_s
    return Canonical(
        sport=sport,
        start_dt=start_dt,
        start_utc=start_utc,
        distance_m=float(distance_m),
        elevation_m=float(elevation_m),
        moving_s=int(moving_s),
        elapsed_s=int(elapsed_s),
        summary=summary,
    )


def find_cross_source_twin(
    provider: str,
    canonical: Canonical,
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


def _activity_pk(provider: str, external_id: str) -> str:
    """Primary key for an activity.

    Strava ids are kept verbatim for backward compatibility; other providers
    are namespaced so their ids cannot collide with Strava's.
    """
    return external_id if provider == "strava" else f"{provider}:{external_id}"


def upsert_activity(
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
    canonical: Canonical,
    import_source: str | None = None,
) -> Activity:
    """Insert or update an activity row plus its streams and best efforts.

    ``import_source`` overrides the value otherwise derived from the source
    file's extension - the sync engine uses it to record the activity's true
    origin (e.g. ``intervals/garmin``); bulk import leaves it ``None``.
    """
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
    # A device's own FIT ``total_calories`` is the authoritative figure, in
    # kcal. Some provider summaries report energy in kilojoules (Garmin's bulk
    # export reports ``calories`` ~4.184x too high), so trust the parsed file
    # value when present and fall back to the summary only without one.
    activity.calories = _merge(parsed.calories if parsed else None, row.calories)
    activity.is_commute = row.is_commute
    activity.gear_name = row.gear_name
    activity.gear_id = gear_slug(row.gear_name, athlete_id) if row.gear_name else None
    if import_source is not None:
        activity.import_source = import_source
    else:
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


def replace_best_efforts(db: Session, activity: Activity, streams: dict[str, list]) -> int:
    """Recompute and replace an activity's best efforts from existing streams.

    Re-derives best efforts in place (e.g. after the computation is improved to
    reject GPS glitches) without needing the original source file. Returns the
    number of best-effort rows written.
    """
    sport = SportType(activity.sport_type)
    efforts = compute_best_efforts(streams, sport)
    db.execute(delete(BestEffort).where(BestEffort.activity_id == activity.activity_id))
    for distance_m, time_s in efforts:
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
    return len(efforts)


def gear_slug(name: str, athlete_id: str = "") -> str:
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

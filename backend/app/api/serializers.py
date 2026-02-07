from __future__ import annotations

from app.domain.best_efforts import DISTANCE_LABELS
from app.domain.streams_analysis import (
    GRADE_ADJUSTED_VELOCITY_STREAM,
    grade_adjusted_velocity_stream,
    mean_max_hr_curve,
    time_in_hr_zones,
    time_in_pace_zones,
)
from app.domain.units import m_to_km, m_to_mi, ms_to_kmh
from app.enums import ActivityType, SportType
from app.models import Activity, Gear
from app.schemas import (
    ActivityDetail,
    ActivitySummary,
    BestEffortItem,
    GearItem,
    HrCurvePoint,
    HrZoneItem,
    PaceZoneItem,
)


def _pace_seconds_per_km(activity: Activity) -> float | None:
    """Average pace in seconds per kilometre, or None when not meaningful."""
    if not activity.distance_m or not activity.moving_time_s:
        return None
    km = activity.distance_m / 1000.0
    if km <= 0:
        return None
    return activity.moving_time_s / km


def serialize_activity_summary(activity: Activity) -> ActivitySummary:
    sport = SportType.from_strava(activity.sport_type)
    return ActivitySummary(
        activity_id=activity.activity_id,
        name=activity.name,
        start_date_time=activity.start_date_time,
        sport_type=activity.sport_type,
        sport_label=sport.label,
        activity_type=activity.activity_type,
        distance_km=round(m_to_km(activity.distance_m), 2),
        distance_mi=round(m_to_mi(activity.distance_m), 2),
        elevation_m=round(activity.elevation_m, 1),
        moving_time_s=activity.moving_time_s,
        elapsed_time_s=activity.elapsed_time_s,
        average_speed_kmh=(
            round(ms_to_kmh(activity.average_speed_ms), 2) if activity.average_speed_ms else None
        ),
        average_pace_s_per_km=_pace_seconds_per_km(activity),
        pace_unit=sport.pace_unit.value,
        average_heart_rate=activity.average_heart_rate,
        max_heart_rate=activity.max_heart_rate,
        average_power=activity.average_power,
        calories=activity.calories,
        is_commute=activity.is_commute,
        gear_name=activity.gear_name,
        has_map=activity.polyline is not None,
    )


_ZONE_LABELS = ["Warm Up", "Easy", "Aerobic", "Threshold", "Maximum"]


def _build_hr_zones(
    streams: dict[str, list], zone_bounds: list[int] | None
) -> list[HrZoneItem] | None:
    if not zone_bounds or len(zone_bounds) < 5:
        return None
    seconds = time_in_hr_zones(streams, zone_bounds)
    total = sum(seconds)
    if total == 0:
        return None
    items: list[HrZoneItem] = []
    for i in range(5):
        items.append(
            HrZoneItem(
                zone=i + 1,
                label=_ZONE_LABELS[i],
                lower_bpm=zone_bounds[i],
                upper_bpm=zone_bounds[i + 1] - 1 if i < 4 else None,
                seconds=seconds[i],
                percentage=round(100 * seconds[i] / total, 1),
            )
        )
    return items


_PACE_ZONE_LABELS = ["Recovery", "Aerobic", "Tempo", "Sub-Threshold", "VO2 Max"]


def _build_pace_zones(
    streams: dict[str, list], zone_boundaries: list[float] | None
) -> list[PaceZoneItem] | None:
    if not zone_boundaries or len(zone_boundaries) < 4:
        return None
    seconds = time_in_pace_zones(streams, zone_boundaries)
    total = sum(seconds)
    if total == 0:
        return None
    items: list[PaceZoneItem] = []
    for i in range(5):
        items.append(
            PaceZoneItem(
                zone=i + 1,
                label=_PACE_ZONE_LABELS[i],
                slow_pace=zone_boundaries[i - 1] if i > 0 else None,
                fast_pace=zone_boundaries[i] if i < 4 else None,
                seconds=seconds[i],
                percentage=round(100 * seconds[i] / total, 1),
            )
        )
    return items


def _build_hr_curve(streams: dict[str, list]) -> list[HrCurvePoint] | None:
    curve = mean_max_hr_curve(streams)
    if not curve:
        return None
    return [HrCurvePoint(duration_s=duration_s, bpm=bpm) for duration_s, bpm in curve]


def serialize_activity_detail(
    activity: Activity,
    streams: dict[str, list],
    best_efforts: list[tuple[int, float]],
    hr_zone_bounds: list[int] | None = None,
    pace_zone_bounds: list[float] | None = None,
) -> ActivityDetail:
    summary = serialize_activity_summary(activity)
    streams = _with_grade_adjusted_pace(activity, streams)
    return ActivityDetail(
        **summary.model_dump(),
        description=activity.description,
        user_note=activity.user_note,
        max_speed_kmh=(
            round(ms_to_kmh(activity.max_speed_ms), 2) if activity.max_speed_ms else None
        ),
        average_cadence=activity.average_cadence,
        max_cadence=activity.max_cadence,
        max_power=activity.max_power,
        normalized_power=(
            round(activity.normalized_power, 1) if activity.normalized_power else None
        ),
        device_name=activity.device_name,
        polyline=activity.polyline,
        start_latitude=activity.start_latitude,
        start_longitude=activity.start_longitude,
        streams=streams,
        best_efforts=[
            BestEffortItem(
                distance_m=distance_m,
                label=DISTANCE_LABELS.get(distance_m, f"{distance_m} m"),
                time_s=time_s,
            )
            for distance_m, time_s in best_efforts
        ],
        hr_zones=_build_hr_zones(streams, hr_zone_bounds),
        pace_zones=_build_pace_zones(streams, pace_zone_bounds),
        hr_curve=_build_hr_curve(streams),
    )


def _with_grade_adjusted_pace(activity: Activity, streams: dict[str, list]) -> dict[str, list]:
    """Augment running streams with a derived grade-adjusted speed series.

    GAP is a running-specific concept (the Minetti slope-cost curve models
    running), so it is only added for runs and only when the velocity, distance
    and altitude needed to compute it are present.
    """
    sport = SportType.from_strava(activity.sport_type)
    if sport.activity_type is not ActivityType.RUN:
        return streams
    gap = grade_adjusted_velocity_stream(streams)
    if gap is None:
        return streams
    return {**streams, GRADE_ADJUSTED_VELOCITY_STREAM: gap}


def serialize_gear(gear: Gear) -> GearItem:
    return GearItem(
        gear_id=gear.gear_id,
        name=gear.name,
        gear_type=gear.gear_type,
        distance_km=round(m_to_km(gear.distance_m), 1),
        is_retired=gear.is_retired,
    )

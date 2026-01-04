from __future__ import annotations

from app.domain.best_efforts import DISTANCE_LABELS
from app.domain.units import m_to_km, m_to_mi, ms_to_kmh
from app.enums import SportType
from app.models import Activity, Gear
from app.schemas import ActivityDetail, ActivitySummary, BestEffortItem, GearItem


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


def serialize_activity_detail(
    activity: Activity, streams: dict[str, list], best_efforts: list[tuple[int, float]]
) -> ActivityDetail:
    summary = serialize_activity_summary(activity)
    return ActivityDetail(
        **summary.model_dump(),
        description=activity.description,
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
    )


def serialize_gear(gear: Gear) -> GearItem:
    return GearItem(
        gear_id=gear.gear_id,
        name=gear.name,
        gear_type=gear.gear_type,
        distance_km=round(m_to_km(gear.distance_m), 1),
        is_retired=gear.is_retired,
    )

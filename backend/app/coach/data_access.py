from __future__ import annotations

from datetime import datetime, timedelta

from sqlalchemy.orm import Session

from app import repository
from app.athlete import HR_ZONE_LABELS, PACE_ZONE_LABELS, AthleteConfig
from app.domain import stats, training_load
from app.domain.streams_analysis import time_in_hr_zones, time_in_pace_zones
from app.enums import StreamType
from app.models import Activity

# This module is the ONLY place the coach reads core data. Tools call these
# helpers, so a change to a core repository/domain signature is absorbed here
# rather than rippling through every tool.

_MAX_ACTIVITIES = 50


def _pace_s_per_km(activity: Activity) -> int | None:
    speed = activity.average_speed_ms
    if not speed or speed <= 0:
        return None
    return round(1000.0 / speed)


def _activity_summary(activity: Activity) -> dict:
    """Compact, unit-friendly view of an activity for the model."""
    return {
        "activity_id": activity.activity_id,
        "name": activity.name,
        "date": activity.start_date_time.date().isoformat(),
        "sport_type": activity.sport_type,
        "distance_km": round((activity.distance_m or 0.0) / 1000, 2),
        "duration_min": round((activity.moving_time_s or 0) / 60, 1),
        "elevation_m": round(activity.elevation_m or 0.0),
        "avg_heart_rate": activity.average_heart_rate,
        "avg_power_w": activity.average_power,
        "avg_pace_s_per_km": _pace_s_per_km(activity),
    }


def recent_activities(db: Session, athlete_id: str, limit: int = 10) -> list[dict]:
    activities = repository.list_activities(
        db, athlete_id, limit=max(1, min(limit, _MAX_ACTIVITIES))
    )
    return [_activity_summary(a) for a in activities]


def activity_details(db: Session, athlete_id: str, activity_id: str) -> dict | None:
    activity = repository.get_activity(db, athlete_id, activity_id)
    if activity is None:
        return None
    summary = _activity_summary(activity)
    summary.update(
        {
            "max_heart_rate": activity.max_heart_rate,
            "max_power_w": activity.max_power,
            "normalized_power_w": activity.normalized_power,
            "avg_cadence": activity.average_cadence,
            "calories": activity.calories,
            "description": activity.description,
            "user_note": activity.user_note,
        }
    )
    return summary


def training_load_summary(db: Session, athlete_id: str, athlete: AthleteConfig) -> dict:
    activities = repository.all_activities(db, athlete_id)
    analysis = training_load.training_load_analysis(activities, athlete, datetime.utcnow().date())
    keys = (
        "ctl",
        "atl",
        "tsb",
        "tsb_status",
        "ac_ratio",
        "ac_status",
        "monotony",
        "strain",
        "weekly_trimp",
        "rest_days",
    )
    return {key: analysis[key] for key in keys}


def period_totals(
    db: Session, athlete_id: str, granularity: str = "week", count: int = 8
) -> list[dict]:
    if granularity not in ("day", "week", "month", "year"):
        granularity = "week"
    activities = repository.all_activities(db, athlete_id)
    per_period = stats.totals_per_period(activities, granularity)
    items = [
        {
            "period": period,
            "count": totals.count,
            "distance_km": round(totals.distance_m / 1000, 1),
            "elevation_m": round(totals.elevation_m),
            "duration_h": round(totals.moving_time_s / 3600, 1),
        }
        for period, totals in per_period.items()
    ]
    return items[-max(1, min(count, 52)) :]


def athlete_profile(athlete: AthleteConfig) -> dict:
    return {
        "age": athlete.age,
        "sex": athlete.sex,
        "weight_kg": athlete.weight_kg,
        "ftp_watts": athlete.ftp,
        "max_heart_rate": athlete.estimated_max_heart_rate(),
        "resting_heart_rate": athlete.resting_heart_rate,
        "threshold_pace_s_per_km": athlete.threshold_pace,
        "unit_system": athlete.unit_system,
        "hr_zone_lower_bounds_bpm": athlete.hr_zone_boundaries(),
        "power_zone_upper_bounds_w": athlete.power_zone_boundaries(),
        "pace_zone_bounds_s_per_km": athlete.pace_zone_boundaries(),
    }


def hr_zones(athlete: AthleteConfig) -> list[dict] | None:
    """Labeled heart-rate training zones (None if max HR is unknown)."""
    bounds = athlete.hr_zone_boundaries()
    if not bounds or len(bounds) < 5:
        return None
    max_hr = athlete.estimated_max_heart_rate()
    return [
        {
            "zone": i + 1,
            "label": HR_ZONE_LABELS[i],
            "lower_bpm": bounds[i],
            "upper_bpm": bounds[i + 1] - 1 if i < 4 else max_hr,
        }
        for i in range(5)
    ]


def pace_zones(athlete: AthleteConfig) -> list[dict] | None:
    """Labeled pace training zones (None if threshold pace is unknown).

    Paces are in seconds per km; higher zones are faster, so each zone runs
    from a slower (larger) to a faster (smaller) pace bound.
    """
    bounds = athlete.pace_zone_boundaries()
    if not bounds or len(bounds) < 4:
        return None
    return [
        {
            "zone": i + 1,
            "label": PACE_ZONE_LABELS[i],
            "slow_pace_s_per_km": bounds[i - 1] if i > 0 else None,
            "fast_pace_s_per_km": bounds[i] if i < 4 else None,
        }
        for i in range(5)
    ]


def _label_zone_seconds(seconds: list[int], labels: list[str]) -> list[dict] | None:
    """Turn a 5-element seconds-per-zone list into labeled shares (None if empty)."""
    total = sum(seconds)
    if total == 0:
        return None
    return [
        {
            "zone": i + 1,
            "label": labels[i],
            "minutes": round(seconds[i] / 60, 1),
            "percentage": round(100 * seconds[i] / total, 1),
        }
        for i in range(5)
    ]


def activity_intensity_distribution(
    db: Session, athlete_id: str, activity_id: str, athlete: AthleteConfig
) -> dict | None:
    """Time spent in each HR and pace zone within one activity (None if not found).

    The streams may lack heart rate or velocity, in which case that breakdown is
    ``None``.
    """
    activity = repository.get_activity(db, athlete_id, activity_id)
    if activity is None:
        return None
    streams = repository.streams_for_activity(db, activity_id)
    hr_bounds = athlete.hr_zone_boundaries()
    pace_bounds = athlete.pace_zone_boundaries()
    return {
        "activity_id": activity_id,
        "sport_type": activity.sport_type,
        "hr_zones": (
            _label_zone_seconds(time_in_hr_zones(streams, hr_bounds), HR_ZONE_LABELS)
            if hr_bounds
            else None
        ),
        "pace_zones": (
            _label_zone_seconds(time_in_pace_zones(streams, pace_bounds), PACE_ZONE_LABELS)
            if pace_bounds
            else None
        ),
    }


_INTENSITY_WINDOW_MAX_DAYS = 365


def intensity_distribution(
    db: Session, athlete_id: str, athlete: AthleteConfig, days: int = 28
) -> dict | None:
    """Aggregate heart-rate-zone time across all activities in a recent window.

    This is the polarization signal: the share of training time spent easy
    versus hard. ``days`` is clamped to [1, 365]. Returns ``None`` when no
    heart-rate data exists in the window.
    """
    hr_bounds = athlete.hr_zone_boundaries()
    if not hr_bounds:
        return None
    days = max(1, min(days, _INTENSITY_WINDOW_MAX_DAYS))
    cutoff = datetime.utcnow() - timedelta(days=days)
    activities = [
        a
        for a in repository.all_activities(db, athlete_id)
        if a.start_date_time >= cutoff and a.average_heart_rate
    ]
    if not activities:
        return None
    all_streams = repository.streams_for_activities(
        db,
        [a.activity_id for a in activities],
        stream_types=[StreamType.TIME.value, StreamType.HEART_RATE.value],
    )
    totals = [0, 0, 0, 0, 0]
    for activity in activities:
        streams = all_streams.get(activity.activity_id, {})
        for index, seconds in enumerate(time_in_hr_zones(streams, hr_bounds)):
            totals[index] += seconds
    zones = _label_zone_seconds(totals, HR_ZONE_LABELS)
    if zones is None:
        return None
    return {
        "days": days,
        "activities_counted": len(activities),
        "total_hours": round(sum(totals) / 3600, 1),
        "hr_zones": zones,
    }


def best_efforts(db: Session, athlete_id: str) -> list[dict]:
    """Fastest time per (activity type, standard distance)."""
    efforts = repository.best_efforts_for_athlete(db, athlete_id)
    best: dict[tuple[str, int], float] = {}
    for effort in efforts:
        key = (effort.activity_type, effort.distance_m)
        if key not in best or effort.time_s < best[key]:
            best[key] = effort.time_s
    rows = [
        {
            "activity_type": activity_type,
            "distance_m": distance_m,
            "best_time_s": round(time_s),
        }
        for (activity_type, distance_m), time_s in best.items()
    ]
    rows.sort(key=lambda r: (r["activity_type"], r["distance_m"]))
    return rows


def goals(db: Session, athlete_id: str) -> list[dict]:
    goal_rows = repository.list_goals(db, athlete_id)
    result = []
    for goal in goal_rows:
        progress = repository.goal_progress(db, athlete_id, goal)
        result.append(
            {
                "metric": goal.metric,
                "target_value": goal.target_value,
                "current_value": round(progress, 1),
                "start_date": goal.start_date.isoformat(),
                "end_date": goal.end_date.isoformat(),
                "sport_types": goal.sport_types,
            }
        )
    return result

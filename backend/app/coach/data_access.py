from __future__ import annotations

from datetime import datetime

from sqlalchemy.orm import Session

from app import repository
from app.athlete import AthleteConfig
from app.domain import stats, training_load
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

from __future__ import annotations

import calendar as _calendar
from datetime import date

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app import repository
from app.api.athletes import get_required_athlete_id as get_athlete_id
from app.api.serializers import serialize_activity_summary
from app.athlete import get_athlete_config
from app.db import get_db
from app.domain.stats import calendar_days
from app.domain.training_load import activity_training_load
from app.domain.units import distance_for_unit, elevation_for_unit
from app.enums import ActivityType, SportType

router = APIRouter(prefix="/api/calendar", tags=["calendar"])


@router.get("/{year}/{month}")
def get_month(
    year: int,
    month: int,
    db: Session = Depends(get_db),
    athlete_id: str = Depends(get_athlete_id),
) -> dict:
    if not 1 <= month <= 12:
        return {"error": "month must be between 1 and 12"}

    athlete = get_athlete_config(db, athlete_id)
    unit_system = athlete.unit_system

    start = date(year, month, 1)
    last_day = _calendar.monthrange(year, month)[1]
    end = date(year, month, last_day)

    activities = [
        a
        for a in repository.all_activities(db, athlete_id)
        if start <= a.start_date_time.date() <= end
    ]
    days = calendar_days(activities)

    day_cells = []
    for day_number in range(1, last_day + 1):
        current = date(year, month, day_number)
        entry = days.get(current)
        day_cells.append(
            {
                "date": current.isoformat(),
                "day": day_number,
                "weekday": current.weekday(),
                "count": entry.count if entry else 0,
                "distance": (
                    round(distance_for_unit(entry.distance_m, unit_system), 1) if entry else 0.0
                ),
                "moving_time_s": entry.moving_time_s if entry else 0,
                "elevation": (
                    round(elevation_for_unit(entry.elevation_m, unit_system), 0) if entry else 0
                ),
                "calories": entry.calories if entry else 0,
                "sport_types": sorted(entry.sport_types) if entry else [],
            }
        )

    totals_distance = sum(a.distance_m for a in activities)
    totals_elevation = sum(a.elevation_m for a in activities)
    totals_moving = sum(a.moving_time_s for a in activities)

    per_sport: dict[str, dict] = {}
    activity_type_by_sport: dict[str, ActivityType] = {}
    for activity in activities:
        sport = SportType.from_strava(activity.sport_type)
        activity_type_by_sport[activity.sport_type] = sport.activity_type
        bucket = per_sport.setdefault(
            activity.sport_type,
            {"label": sport.label, "count": 0, "distance": 0.0, "moving_time_s": 0},
        )
        bucket["count"] += 1
        bucket["distance"] += distance_for_unit(activity.distance_m, unit_system)
        bucket["moving_time_s"] += activity.moving_time_s

    # Keep sports of the same broad activity type together (e.g. Run next to
    # Trail Run) instead of interleaving them by distance alone: order the
    # groups, then the sports within each group, by distance descending.
    group_distance: dict[ActivityType, float] = {}
    for sport_type, bucket in per_sport.items():
        group = activity_type_by_sport[sport_type]
        group_distance[group] = group_distance.get(group, 0.0) + bucket["distance"]

    def _grouped_sort_key(item: tuple[str, dict]) -> tuple[float, str, float]:
        sport_type, bucket = item
        group = activity_type_by_sport[sport_type]
        return (-group_distance[group], group.value, -bucket["distance"])

    return {
        "year": year,
        "month": month,
        "month_name": _calendar.month_name[month],
        "first_weekday": start.weekday(),
        "days_in_month": last_day,
        "unit_system": unit_system,
        "totals": {
            "count": len(activities),
            "distance": round(distance_for_unit(totals_distance, unit_system), 1),
            "elevation": round(elevation_for_unit(totals_elevation, unit_system), 0),
            "moving_time_s": totals_moving,
        },
        "per_sport": [
            {
                "sport_type": key,
                **{k: (round(v, 1) if isinstance(v, float) else v) for k, v in value.items()},
            }
            for key, value in sorted(per_sport.items(), key=_grouped_sort_key)
        ],
        "days": day_cells,
        "activities": [
            {
                **serialize_activity_summary(a).model_dump(),
                "load": round(activity_training_load(a, athlete)),
            }
            for a in activities
        ],
    }

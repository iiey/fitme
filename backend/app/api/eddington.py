from __future__ import annotations

from collections import defaultdict
from datetime import date

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app import repository
from app.api.athletes import get_required_athlete_id as get_athlete_id
from app.athlete import get_athlete
from app.db import get_db
from app.domain.eddington import compute_eddington
from app.domain.units import distance_for_unit, distance_unit_label
from app.enums import SportType

router = APIRouter(prefix="/api/eddington", tags=["eddington"])


def _daily_distances_by_activity_type(activities, unit_system: str) -> dict[str, dict[date, float]]:
    grouped: dict[str, dict[date, float]] = defaultdict(lambda: defaultdict(float))
    for activity in activities:
        sport = SportType.from_strava(activity.sport_type)
        if not sport.is_distance_based:
            continue
        day = activity.start_date_time.date()
        grouped[activity.activity_type][day] += distance_for_unit(activity.distance_m, unit_system)
    return {key: dict(value) for key, value in grouped.items()}


@router.get("")
def get_eddington(
    db: Session = Depends(get_db),
    athlete_id: str = Depends(get_athlete_id),
    unit: str | None = None,
) -> dict:
    athlete = get_athlete()
    unit_system = "imperial" if (unit or athlete.unit_system) == "imperial" else "metric"
    unit_label = distance_unit_label(unit_system)

    activities = repository.all_activities(db, athlete_id)
    grouped = _daily_distances_by_activity_type(activities, unit_system)

    results = []
    for activity_type, distances_per_day in grouped.items():
        result = compute_eddington(distances_per_day, unit_label)
        if result.number == 0 and not result.times_completed:
            continue
        results.append(
            {
                "activity_type": activity_type,
                "number": result.number,
                "unit": result.unit,
                "longest_day": result.longest_day,
                "times_completed": [
                    {"distance": d, "count": c} for d, c in result.times_completed.items()
                ],
                "days_to_next": [
                    {"distance": d, "days_needed": n} for d, n in result.days_to_next.items()
                ],
                "history": [
                    {"number": n, "date": day.isoformat()} for n, day in result.history.items()
                ],
            }
        )

    results.sort(key=lambda item: item["number"], reverse=True)
    return {"unit": unit_label, "unit_system": unit_system, "results": results}

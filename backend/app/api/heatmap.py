from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app import repository
from app.db import get_db

router = APIRouter(prefix="/api/heatmap", tags=["heatmap"])


@router.get("/routes")
def get_routes(
    db: Session = Depends(get_db),
    sport_type: list[str] | None = Query(default=None),
    activity_type: list[str] | None = Query(default=None),
    start: datetime | None = None,
    end: datetime | None = None,
    commute: bool | None = None,
) -> dict:
    """Encoded polylines for all matching activities, for the Leaflet heatmap."""
    activities = repository.activities_with_polyline(db)

    routes = []
    sport_set = set(sport_type) if sport_type else None
    activity_set = set(activity_type) if activity_type else None
    country_codes: set[str] = set()

    for activity in activities:
        if sport_set and activity.sport_type not in sport_set:
            continue
        if activity_set and activity.activity_type not in activity_set:
            continue
        if start and activity.start_date_time < start:
            continue
        if end and activity.start_date_time > end:
            continue
        if commute is not None and activity.is_commute != commute:
            continue

        if activity.country_code:
            country_codes.add(activity.country_code)

        routes.append(
            {
                "activity_id": activity.activity_id,
                "name": activity.name,
                "sport_type": activity.sport_type,
                "activity_type": activity.activity_type,
                "polyline": activity.polyline,
                "start_date": activity.start_date_time.date().isoformat(),
            }
        )

    return {
        "count": len(routes),
        "country_count": len(country_codes),
        "routes": routes,
    }

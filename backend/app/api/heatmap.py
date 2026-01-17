from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app import repository
from app.api.athletes import get_athlete_id
from app.db import get_db

router = APIRouter(prefix="/api/heatmap", tags=["heatmap"])


MAX_HEATMAP_ROUTES = 500


@router.get("/routes")
def get_routes(
    db: Session = Depends(get_db),
    athlete_id: str = Depends(get_athlete_id),
    sport_type: list[str] | None = Query(default=None),
    activity_type: list[str] | None = Query(default=None),
    start: datetime | None = None,
    end: datetime | None = None,
    commute: bool | None = None,
    limit: int = Query(default=MAX_HEATMAP_ROUTES, ge=1, le=5000),
    offset: int = Query(default=0, ge=0),
) -> dict:
    """Encoded polylines for matching activities, for the Leaflet heatmap."""
    activities = repository.activities_with_polyline(db, athlete_id)

    filtered = []
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
        filtered.append(activity)

    total = len(filtered)
    page = filtered[offset : offset + limit]
    routes = [
        {
            "activity_id": a.activity_id,
            "name": a.name,
            "sport_type": a.sport_type,
            "activity_type": a.activity_type,
            "polyline": a.polyline,
            "start_date": a.start_date_time.date().isoformat(),
        }
        for a in page
    ]

    return {
        "total": total,
        "count": len(routes),
        "country_count": len(country_codes),
        "routes": routes,
    }

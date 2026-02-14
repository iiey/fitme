from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app import repository
from app.api.athletes import get_required_athlete_id as get_athlete_id
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
    page, total, country_count = repository.heatmap_routes(
        db,
        athlete_id,
        sport_types=sport_type,
        activity_types=activity_type,
        start=start,
        end=end,
        commute=commute,
        limit=limit,
        offset=offset,
    )
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
        "country_count": country_count,
        "routes": routes,
    }

from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import repository
from app.api.athletes import get_required_athlete_id as get_athlete_id
from app.api.serializers import serialize_activity_detail, serialize_activity_summary
from app.athlete import get_athlete_config
from app.db import get_db
from app.domain.best_efforts import (  # noqa: F401  (kept for label parity)
    DISTANCE_LABELS,
)
from app.domain.search import parse_activity_search
from app.models import BestEffort
from app.schemas import ActivityDetail, ActivityNoteUpdate, PaginatedActivities

router = APIRouter(prefix="/api/activities", tags=["activities"])

_SORTABLE_COLUMNS = {
    "start_date_time",
    "distance_m",
    "elevation_m",
    "moving_time_s",
    "average_speed_ms",
    "average_heart_rate",
    "average_power",
    "name",
}


@router.get("", response_model=PaginatedActivities)
def list_activities(
    db: Session = Depends(get_db),
    athlete_id: str = Depends(get_athlete_id),
    sport_type: list[str] | None = Query(default=None),
    activity_type: list[str] | None = Query(default=None),
    start: datetime | None = None,
    end: datetime | None = None,
    distance_min: float | None = Query(default=None, description="Min distance in km"),
    distance_max: float | None = Query(default=None, description="Max distance in km"),
    search: str | None = None,
    sort: str = "start_date_time",
    order: str = "desc",
    limit: int = Query(default=25, ge=1, le=1000),
    offset: int = Query(default=0, ge=0),
) -> PaginatedActivities:
    sort_column = sort if sort in _SORTABLE_COLUMNS else "start_date_time"
    descending = order.lower() != "asc"

    parsed = parse_activity_search(search)
    # The explicit sport dropdown stays a hard filter; a sport word typed into
    # the search box matches by sport type OR name (see ParsedSearch.sport_terms),
    # so e.g. a "Trail Run" logged as a plain Run is still found by "trail".
    sport_filter = sorted(set(sport_type)) if sport_type else None
    start_filter = start or parsed.start
    end_filter = end or parsed.end

    filters = {
        "sport_types": sport_filter,
        "activity_types": activity_type,
        "start": start_filter,
        "end": end_filter,
        "name_terms": parsed.terms,
        "sport_or_name_terms": [(term.sport_types, term.token) for term in parsed.sport_terms],
        "distance_min_m": distance_min * 1000 if distance_min is not None else None,
        "distance_max_m": distance_max * 1000 if distance_max is not None else None,
    }

    total = repository.count_activities(db, athlete_id, **filters)
    activities = repository.list_activities(
        db,
        athlete_id,
        **filters,
        order_by=sort_column,
        descending=descending,
        limit=limit,
        offset=offset,
    )
    return PaginatedActivities(
        total=total,
        limit=limit,
        offset=offset,
        items=[serialize_activity_summary(a) for a in activities],
    )


@router.get("/{activity_id}", response_model=ActivityDetail)
def get_activity(
    activity_id: str,
    db: Session = Depends(get_db),
    athlete_id: str = Depends(get_athlete_id),
) -> ActivityDetail:
    activity = repository.get_activity(db, athlete_id, activity_id)
    if activity is None:
        raise HTTPException(status_code=404, detail="Activity not found")

    streams = repository.streams_for_activity(db, activity_id)
    efforts = (
        db.execute(
            select(BestEffort)
            .where(BestEffort.activity_id == activity_id)
            .order_by(BestEffort.distance_m.asc())
        )
        .scalars()
        .all()
    )
    best_efforts = [(e.distance_m, e.time_s) for e in efforts]
    athlete = get_athlete_config(db, athlete_id)
    return serialize_activity_detail(
        activity,
        streams,
        best_efforts,
        hr_zone_bounds=athlete.hr_zone_boundaries(),
        pace_zone_bounds=athlete.pace_zone_boundaries(),
    )


@router.put("/{activity_id}/note")
def update_note(
    activity_id: str,
    body: ActivityNoteUpdate,
    db: Session = Depends(get_db),
    athlete_id: str = Depends(get_athlete_id),
) -> dict[str, str | None]:
    activity = repository.update_activity_note(db, athlete_id, activity_id, body.note)
    if activity is None:
        raise HTTPException(status_code=404, detail="Activity not found")
    return {"activity_id": activity.activity_id, "user_note": activity.user_note}

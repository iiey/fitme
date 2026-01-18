from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app import repository
from app.api.athletes import get_required_athlete_id as get_athlete_id
from app.athlete import get_athlete
from app.db import get_db
from app.domain.rewind import available_years, build_rewind

router = APIRouter(prefix="/api/rewind", tags=["rewind"])


@router.get("")
def get_rewind(
    db: Session = Depends(get_db),
    athlete_id: str = Depends(get_athlete_id),
    year: int | None = None,
    days: int | None = None,
) -> dict:
    athlete = get_athlete()
    activities = repository.all_activities(db, athlete_id)
    years = available_years(activities)
    return {
        "available_years": years,
        "selected_year": year,
        "rewind": build_rewind(activities, year, athlete.unit_system, days),
    }

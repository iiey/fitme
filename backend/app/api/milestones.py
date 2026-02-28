from __future__ import annotations

from collections import defaultdict

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app import repository
from app.api.athletes import get_required_athlete_id as get_athlete_id
from app.athlete import get_athlete_config
from app.db import get_db
from app.domain.milestones import MilestoneGroup, discover_milestones

router = APIRouter(prefix="/api/milestones", tags=["milestones"])


@router.get("")
def get_milestones(
    db: Session = Depends(get_db),
    athlete_id: str = Depends(get_athlete_id),
) -> dict:
    athlete = get_athlete_config(db, athlete_id)
    activities = repository.all_activities(db, athlete_id)
    # Join best efforts on athlete_id rather than an IN-list of activity ids,
    # which overflows SQLite's bound-variable limit on large histories.
    best_efforts = repository.best_efforts_for_athlete(db, athlete_id)

    milestones = discover_milestones(activities, best_efforts, athlete.unit_system)

    by_year: dict[int, list[dict]] = defaultdict(list)
    for milestone in milestones:
        by_year[milestone.achieved_on.year].append(milestone.as_dict())

    timeline = [
        {"year": year, "milestones": items} for year, items in sorted(by_year.items(), reverse=True)
    ]

    return {
        "groups": [group.value for group in MilestoneGroup],
        "total": len(milestones),
        "timeline": timeline,
    }

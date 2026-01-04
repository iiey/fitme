from __future__ import annotations

from collections import defaultdict

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import repository
from app.athlete import get_athlete
from app.db import get_db
from app.domain.milestones import MilestoneGroup, discover_milestones
from app.models import BestEffort

router = APIRouter(prefix="/api/milestones", tags=["milestones"])


@router.get("")
def get_milestones(db: Session = Depends(get_db)) -> dict:
    athlete = get_athlete()
    activities = repository.all_activities(db)
    best_efforts = list(db.execute(select(BestEffort)).scalars().all())

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

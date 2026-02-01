from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app import repository
from app.api.athletes import get_required_athlete_id as get_athlete_id
from app.db import get_db
from app.models import Goal
from app.schemas import (
    GoalCreate,
    GoalProgressResponse,
    GoalResponse,
    GoalUpdate,
)

router = APIRouter(prefix="/api/goals", tags=["goals"])

_VALID_METRICS = {"distance_m", "count", "elevation_m", "moving_time_s", "calories"}


def _goal_response(goal: Goal) -> GoalResponse:
    return GoalResponse(
        id=goal.id,
        athlete_id=goal.athlete_id,
        start_date=goal.start_date,
        end_date=goal.end_date,
        sport_type=goal.sport_type,
        metric=goal.metric,
        target_value=goal.target_value,
        note=goal.note,
        created_on=goal.created_on,
        updated_on=goal.updated_on,
    )


@router.get("", response_model=list[GoalResponse])
def list_goals(
    db: Session = Depends(get_db),
    athlete_id: str = Depends(get_athlete_id),
    active_on: date | None = Query(default=None),
) -> list[GoalResponse]:
    goals = repository.list_goals(db, athlete_id, active_on=active_on)
    return [_goal_response(g) for g in goals]


@router.get("/progress", response_model=list[GoalProgressResponse])
def goals_progress(
    db: Session = Depends(get_db),
    athlete_id: str = Depends(get_athlete_id),
    active_on: date | None = Query(default=None),
) -> list[GoalProgressResponse]:
    goals = repository.list_goals(db, athlete_id, active_on=active_on)
    result: list[GoalProgressResponse] = []
    for goal in goals:
        current = repository.goal_progress(db, athlete_id, goal)
        pct = (
            min(100.0, round(100.0 * current / goal.target_value, 1)) if goal.target_value else 0.0
        )
        result.append(
            GoalProgressResponse(
                **_goal_response(goal).model_dump(),
                current_value=current,
                percentage=pct,
            )
        )
    return result


@router.post("", response_model=GoalResponse, status_code=201)
def create_goal(
    body: GoalCreate,
    db: Session = Depends(get_db),
    athlete_id: str = Depends(get_athlete_id),
) -> GoalResponse:
    if body.metric not in _VALID_METRICS:
        raise HTTPException(
            400, f"Invalid metric. Must be one of: {', '.join(sorted(_VALID_METRICS))}"
        )
    if body.end_date < body.start_date:
        raise HTTPException(400, "end_date must be >= start_date")
    goal = Goal(
        athlete_id=athlete_id,
        start_date=body.start_date,
        end_date=body.end_date,
        sport_type=body.sport_type,
        metric=body.metric,
        target_value=body.target_value,
        note=body.note,
    )
    goal = repository.create_goal(db, goal)
    return _goal_response(goal)


@router.put("/{goal_id}", response_model=GoalResponse)
def update_goal(
    goal_id: int,
    body: GoalUpdate,
    db: Session = Depends(get_db),
    athlete_id: str = Depends(get_athlete_id),
) -> GoalResponse:
    goal = repository.get_goal(db, athlete_id, goal_id)
    if goal is None:
        raise HTTPException(404, "Goal not found")
    if body.metric is not None and body.metric not in _VALID_METRICS:
        raise HTTPException(
            400, f"Invalid metric. Must be one of: {', '.join(sorted(_VALID_METRICS))}"
        )
    for field in ("start_date", "end_date", "sport_type", "metric", "target_value", "note"):
        value = getattr(body, field, None)
        if value is not None:
            setattr(goal, field, value)
    if goal.end_date < goal.start_date:
        raise HTTPException(400, "end_date must be >= start_date")
    goal = repository.update_goal(db, goal)
    return _goal_response(goal)


@router.delete("/{goal_id}", status_code=204)
def delete_goal(
    goal_id: int,
    db: Session = Depends(get_db),
    athlete_id: str = Depends(get_athlete_id),
) -> None:
    if not repository.delete_goal(db, athlete_id, goal_id):
        raise HTTPException(404, "Goal not found")

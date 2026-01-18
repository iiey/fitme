from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import (
    Activity,
    ActivityStream,
    AthleteProfile,
    BestEffort,
    Gear,
    ImportRun,
)

router = APIRouter(prefix="/api/athletes", tags=["athletes"])

STRAVA_ATHLETE_URL = "https://www.strava.com/athletes/{athlete_id}"


def get_athlete_id(
    athlete: str | None = Query(default=None),
    db: Session = Depends(get_db),
) -> str | None:
    """Resolve the active athlete_id from the query string or fall back to the most recent.

    An unknown ``athlete`` (e.g. an id cached in the browser after a database
    reset or a fresh import of a different export) is treated like no selection
    and falls back to the most recent athlete, so the UI can recover and
    re-select a valid athlete instead of every endpoint failing with a 404.
    """
    if athlete:
        profile = db.get(AthleteProfile, athlete)
        if profile is not None:
            return athlete
    first = (
        db.execute(select(AthleteProfile).order_by(AthleteProfile.updated_on.desc()))
        .scalars()
        .first()
    )
    if first is None:
        return None
    return first.athlete_id


def get_required_athlete_id(
    athlete_id: str | None = Depends(get_athlete_id),
) -> str:
    """Like ``get_athlete_id`` but raises 404 when no athlete exists."""
    if athlete_id is None:
        raise HTTPException(404, "No athletes found. Import data first.")
    return athlete_id


def _profile_to_dict(profile: AthleteProfile, activity_count: int) -> dict:
    name = " ".join(part for part in (profile.first_name, profile.last_name) if part)
    location = ", ".join(part for part in (profile.city, profile.country) if part)
    return {
        "athlete_id": profile.athlete_id,
        "name": name or None,
        "location": location or None,
        "activity_count": activity_count,
        "profile_url": STRAVA_ATHLETE_URL.format(athlete_id=profile.athlete_id),
    }


@router.get("")
def list_athletes(db: Session = Depends(get_db)) -> list[dict]:
    profiles = (
        db.execute(select(AthleteProfile).order_by(AthleteProfile.first_name)).scalars().all()
    )
    counts: dict[str, int] = {}
    for aid, cnt in db.execute(
        select(Activity.athlete_id, func.count()).group_by(Activity.athlete_id)
    ).all():
        counts[aid] = cnt

    return [_profile_to_dict(p, counts.get(p.athlete_id, 0)) for p in profiles]


@router.delete("/{athlete_id}", status_code=204)
def delete_athlete(athlete_id: str, db: Session = Depends(get_db)) -> None:
    profile = db.get(AthleteProfile, athlete_id)
    if profile is None:
        raise HTTPException(404, f"Athlete '{athlete_id}' not found")

    activity_ids = list(
        db.execute(select(Activity.activity_id).where(Activity.athlete_id == athlete_id))
        .scalars()
        .all()
    )

    _CHUNK = 500
    for i in range(0, len(activity_ids), _CHUNK):
        chunk = activity_ids[i : i + _CHUNK]
        db.execute(delete(ActivityStream).where(ActivityStream.activity_id.in_(chunk)))
        db.execute(delete(BestEffort).where(BestEffort.activity_id.in_(chunk)))

    db.execute(delete(Activity).where(Activity.athlete_id == athlete_id))
    db.execute(delete(Gear).where(Gear.athlete_id == athlete_id))
    db.execute(delete(ImportRun).where(ImportRun.athlete_id == athlete_id))
    db.delete(profile)
    db.commit()

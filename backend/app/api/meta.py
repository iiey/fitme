from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app import repository
from app.athlete import get_athlete
from app.config import settings
from app.db import get_db
from app.domain.units import distance_unit_label, elevation_unit_label
from app.enums import SportType
from app.models import AthleteProfile
from app.schemas import AthleteInfo, MetaResponse, SportTypeOption

router = APIRouter(tags=["meta"])

STRAVA_ATHLETE_URL = "https://www.strava.com/athletes/{athlete_id}"


def _athlete_info(db: Session) -> AthleteInfo | None:
    profile = db.get(AthleteProfile, 1)
    if profile is None:
        return None
    name = " ".join(part for part in (profile.first_name, profile.last_name) if part)
    location = ", ".join(part for part in (profile.city, profile.country) if part)
    profile_url = (
        STRAVA_ATHLETE_URL.format(athlete_id=profile.athlete_id) if profile.athlete_id else None
    )
    return AthleteInfo(
        athlete_id=profile.athlete_id,
        name=name or None,
        location=location or None,
        profile_url=profile_url,
    )


@router.get("/api/meta", response_model=MetaResponse)
def get_meta(db: Session = Depends(get_db)) -> MetaResponse:
    athlete = get_athlete()
    unit_system = athlete.unit_system
    first, last = repository.date_range(db)
    used_sports = repository.distinct_sport_types(db)

    options = [
        SportTypeOption(
            value=sport.value,
            label=sport.label,
            activity_type=sport.activity_type.value,
        )
        for sport in (SportType.from_strava(value) for value in used_sports)
    ]

    return MetaResponse(
        app_name=settings.app_name,
        app_subtitle=settings.app_subtitle,
        unit_system=unit_system,
        distance_unit=distance_unit_label(unit_system),
        elevation_unit=elevation_unit_label(unit_system),
        sport_types=sorted(options, key=lambda o: o.label),
        activity_count=repository.count_activities(db),
        first_activity=first,
        last_activity=last,
        athlete=_athlete_info(db),
    )

from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app import repository
from app.api.athletes import get_athlete_id, list_athletes
from app.athlete import get_athlete_config
from app.config import settings
from app.db import get_db
from app.domain.units import distance_unit_label, elevation_unit_label
from app.enums import SportType
from app.models import AthleteProfile
from app.schemas import AthleteInfo, MetaResponse, SportTypeOption

router = APIRouter(tags=["meta"])

STRAVA_ATHLETE_URL = "https://www.strava.com/athletes/{athlete_id}"


def _athlete_info(db: Session, athlete_id: str) -> AthleteInfo | None:
    profile = db.get(AthleteProfile, athlete_id)
    if profile is None:
        return None
    name = " ".join(part for part in (profile.first_name, profile.last_name) if part)
    location = ", ".join(part for part in (profile.city, profile.country) if part)
    profile_url = STRAVA_ATHLETE_URL.format(athlete_id=profile.athlete_id)
    return AthleteInfo(
        athlete_id=profile.athlete_id,
        name=name or None,
        location=location or None,
        profile_url=profile_url,
    )


@router.get("/api/meta", response_model=MetaResponse)
def get_meta(
    db: Session = Depends(get_db),
    athlete_id: str | None = Depends(get_athlete_id),
) -> MetaResponse:
    athlete = get_athlete_config(db, athlete_id)
    unit_system = athlete.unit_system

    if athlete_id is None:
        return MetaResponse(
            app_name=settings.app_name,
            app_subtitle=settings.app_subtitle,
            unit_system=unit_system,
            distance_unit=distance_unit_label(unit_system),
            elevation_unit=elevation_unit_label(unit_system),
            sport_types=[],
            activity_count=0,
            first_activity=None,
            last_activity=None,
            athlete=None,
            athletes=[],
        )

    first, last = repository.date_range(db, athlete_id)
    used_sports = repository.distinct_sport_types(db, athlete_id)

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
        activity_count=repository.count_activities(db, athlete_id),
        first_activity=first,
        last_activity=last,
        athlete=_athlete_info(db, athlete_id),
        athletes=list_athletes(db),
    )

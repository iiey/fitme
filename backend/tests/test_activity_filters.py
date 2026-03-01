"""Repository-level coverage for the activity range filters (time/speed/
elevation/HR) added to the activities listing."""

from __future__ import annotations

from datetime import datetime

import pytest

from app import repository
from app.models import Activity, AthleteProfile

ATHLETE_ID = "42"


def _add(
    db,
    activity_id: str,
    *,
    moving_time_s: int,
    average_speed_ms: float | None,
    elevation_m: float,
    average_heart_rate: int | None,
) -> None:
    db.add(
        Activity(
            activity_id=activity_id,
            athlete_id=ATHLETE_ID,
            source="intervals",
            external_id=activity_id,
            start_date_time=datetime(2024, 11, 20, 7, 0, 0),
            start_utc=datetime(2024, 11, 20, 6, 0, 0),
            sport_type="Run",
            activity_type="Run",
            name=f"Activity {activity_id}",
            distance_m=10000.0,
            moving_time_s=moving_time_s,
            elapsed_time_s=moving_time_s + 60,
            elevation_m=elevation_m,
            average_speed_ms=average_speed_ms,
            average_heart_rate=average_heart_rate,
        )
    )


@pytest.fixture
def seeded(db_session):
    """Three activities with distinct time/speed/elevation/HR, plus a no-HR one."""
    db_session.add(AthleteProfile(athlete_id=ATHLETE_ID, first_name="Test"))
    _add(
        db_session,
        "a",
        moving_time_s=1800,
        average_speed_ms=2.5,
        elevation_m=50,
        average_heart_rate=120,
    )
    _add(
        db_session,
        "b",
        moving_time_s=3600,
        average_speed_ms=3.5,
        elevation_m=500,
        average_heart_rate=150,
    )
    _add(
        db_session,
        "c",
        moving_time_s=7200,
        average_speed_ms=5.0,
        elevation_m=1200,
        average_heart_rate=None,
    )
    db_session.commit()
    return db_session


def _ids(db, **filters) -> set[str]:
    return {a.activity_id for a in repository.list_activities(db, ATHLETE_ID, **filters)}


def test_moving_time_filter(seeded):
    assert _ids(seeded, moving_time_min_s=3000) == {"b", "c"}
    assert _ids(seeded, moving_time_max_s=2000) == {"a"}
    assert _ids(seeded, moving_time_min_s=3000, moving_time_max_s=4000) == {"b"}


def test_speed_filter(seeded):
    assert _ids(seeded, speed_min_ms=3.0) == {"b", "c"}
    assert _ids(seeded, speed_max_ms=3.0) == {"a"}


def test_elevation_filter(seeded):
    assert _ids(seeded, elevation_min_m=400) == {"b", "c"}
    assert _ids(seeded, elevation_max_m=100) == {"a"}


def test_hr_filter_excludes_null_hr(seeded):
    # The no-HR activity ("c") is excluded by either HR bound.
    assert _ids(seeded, hr_min=130) == {"b"}
    assert _ids(seeded, hr_max=130) == {"a"}


def test_count_matches_filtered_list(seeded):
    assert repository.count_activities(seeded, ATHLETE_ID, elevation_min_m=400) == 2
    assert repository.count_activities(seeded, ATHLETE_ID, hr_min=130) == 1

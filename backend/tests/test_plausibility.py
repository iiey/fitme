"""Constraint-function coverage: GPS-route and best-effort plausibility, plus
their effect on the heatmap listing."""

from __future__ import annotations

from datetime import datetime

import pytest

from app import repository
from app.domain.plausibility import (
    MIN_TELEPORT_JUMP_M,
    best_effort_is_plausible,
    route_is_suspect,
)
from app.enums import SportType
from app.models import Activity, AthleteProfile

ATHLETE_ID = "42"

# A short loop in Bensheim, DE: consecutive fixes a few hundred metres apart.
_CLEAN_ROUTE = [
    [49.6810, 8.6190],
    [49.6825, 8.6215],
    [49.6840, 8.6240],
    [49.6855, 8.6265],
]


def test_clean_route_is_not_suspect():
    assert route_is_suspect(_CLEAN_ROUTE, total_distance_m=8000.0) is False


def test_teleport_jump_is_suspect():
    # A single fix jumps to another country - a hop far longer than the whole
    # activity, so it cannot be real.
    route = [*_CLEAN_ROUTE, [52.5200, 13.4050]]  # Berlin, ~470 km away
    assert route_is_suspect(route, total_distance_m=8000.0) is True


def test_null_island_fix_is_suspect():
    route = [_CLEAN_ROUTE[0], [0.0, 0.0], _CLEAN_ROUTE[1]]
    assert route_is_suspect(route, total_distance_m=8000.0) is True


def test_out_of_range_fix_is_suspect():
    route = [_CLEAN_ROUTE[0], [999.0, 8.62], _CLEAN_ROUTE[1]]
    assert route_is_suspect(route, total_distance_m=8000.0) is True


def test_long_straight_segment_within_total_is_not_suspect():
    # A point-to-point ride: one long straight leg that stays well under the
    # activity's total distance is a real road, not a teleport.
    route = [[48.0, 8.0], [48.09, 8.0]]  # ~10 km straight
    assert route_is_suspect(route, total_distance_m=100_000.0) is False


def test_teleport_floor_guards_missing_distance():
    # With no reliable distance (0 m), a jump beyond the absolute floor is still
    # rejected; a small jump under it is kept.
    near = [[48.0, 8.0], [48.0 + 0.005, 8.0]]  # ~560 m < floor
    assert route_is_suspect(near, total_distance_m=0.0) is False
    far = [[48.0, 8.0], [48.05, 8.0]]  # ~5.5 km > floor
    assert far and route_is_suspect(far, total_distance_m=0.0) is True
    assert MIN_TELEPORT_JUMP_M == 2000.0


def test_too_few_points_never_suspect():
    assert route_is_suspect([], total_distance_m=100.0) is False
    assert route_is_suspect([[49.0, 8.0]], total_distance_m=100.0) is False
    assert route_is_suspect([None, [49.0, 8.0]], total_distance_m=100.0) is False


def test_best_effort_plausibility_bounds():
    # 400 m in 30 s = 13.3 m/s - superhuman for a run, so rejected.
    assert best_effort_is_plausible(400, 30.0, SportType.RUN) is False
    # 400 m in 60 s = 6.7 m/s - a real fast rep, kept.
    assert best_effort_is_plausible(400, 60.0, SportType.RUN) is True
    # Zero/negative elapsed time is never plausible.
    assert best_effort_is_plausible(400, 0.0, SportType.RUN) is False


def _add_route_activity(db, activity_id: str, *, suspect: bool) -> None:
    db.add(
        Activity(
            activity_id=activity_id,
            athlete_id=ATHLETE_ID,
            source="strava",
            external_id=activity_id,
            start_date_time=datetime(2026, 6, 30, 6, 8, 0),
            start_utc=datetime(2026, 6, 30, 4, 8, 0),
            sport_type="Run",
            activity_type="Run",
            name=f"Activity {activity_id}",
            distance_m=8000.0,
            moving_time_s=2400,
            elapsed_time_s=2460,
            elevation_m=30.0,
            polyline="dummy",
            route_is_suspect=suspect,
        )
    )


@pytest.fixture
def seeded(db_session):
    db_session.add(AthleteProfile(athlete_id=ATHLETE_ID, first_name="Test"))
    _add_route_activity(db_session, "clean", suspect=False)
    _add_route_activity(db_session, "glitch", suspect=True)
    db_session.commit()
    return db_session


def test_heatmap_excludes_suspect_routes(seeded):
    page, total, _ = repository.heatmap_routes(seeded, ATHLETE_ID, limit=100, offset=0)
    ids = {a.activity_id for a in page}
    assert ids == {"clean"}
    assert total == 1

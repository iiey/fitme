from __future__ import annotations

from datetime import datetime

from app.athlete import estimate_threshold_pace
from app.domain.threshold import (
    riegel_predicted_pace,
    threshold_pace_from_best_efforts,
)
from app.enums import ActivityType, SportType
from app.models import Activity, BestEffort


def test_riegel_pace_is_identity_at_same_duration():
    # Scaling an effort to its own duration must return its own pace.
    pace = riegel_predicted_pace(1500.0, 5000.0, reference_s=1500.0)
    assert round(pace) == 300  # 5000 m in 1500 s = 5:00/km


def test_riegel_slows_pace_for_a_longer_reference():
    # A 5 km in 1500 s (5:00/km) predicts a slower one-hour pace.
    pace = riegel_predicted_pace(1500.0, 5000.0, reference_s=3600.0)
    assert pace > 300


def test_threshold_uses_fastest_sustained_effort():
    # A genuine hard 5 km (26:18, ~5:16/km) plus sub-maximal long runs. The
    # estimate must follow the 5 km, not the slow long runs.
    points = [
        (1578.0, 5000.0),  # 26:18 5 km - fastest sustained
        (3607.0, 10000.0),  # 60:07 10 km - easy-run segment, sub-maximal
        (8594.0, 21097.0),  # slow long run
    ]
    expected = round(riegel_predicted_pace(1578.0, 5000.0))
    assert threshold_pace_from_best_efforts(points) == expected
    assert expected == 331  # ~5:31/km


def test_short_efforts_and_gps_spikes_are_ignored():
    # A 19 s "400 m" GPS spike and a 3:51 1 km are both under 20 min -> ignored;
    # only the sustained 5 km counts.
    points = [
        (19.0, 400.0),  # impossible spike
        (231.0, 1000.0),  # 1 km, too short to be sustained
        (1578.0, 5000.0),  # sustained
    ]
    assert threshold_pace_from_best_efforts(points) == 331


def test_no_sustained_effort_returns_none():
    # Only short efforts -> cannot anchor a threshold estimate.
    assert threshold_pace_from_best_efforts([(231.0, 1000.0), (358.0, 1609.0)]) is None
    assert threshold_pace_from_best_efforts([]) is None


def _run(activity_id: str, distance_m: int, time_s: float) -> Activity:
    return Activity(
        activity_id=activity_id,
        athlete_id="a1",
        start_date_time=datetime(2024, 4, 1, 7, 0, 0),
        sport_type=SportType.RUN.value,
        activity_type=ActivityType.RUN.value,
        name="Run",
        distance_m=float(distance_m),
        moving_time_s=int(time_s),
        elapsed_time_s=int(time_s),
        average_speed_ms=distance_m / time_s,
    )


def _best_effort(activity_id: str, distance_m: int, time_s: float) -> BestEffort:
    return BestEffort(
        activity_id=activity_id,
        distance_m=distance_m,
        sport_type=SportType.RUN.value,
        activity_type=ActivityType.RUN.value,
        start_date_time=datetime(2024, 4, 1, 7, 0, 0),
        time_s=time_s,
    )


def test_estimate_prefers_best_efforts(db_session):
    # Best efforts present -> Riegel estimate from the fastest sustained effort,
    # independent of the (slower) whole-run average.
    db_session.add(_run("r1", 5000, 1800))  # 6:00/km average run
    db_session.add_all(
        [
            _best_effort("r1", 3219, 819),  # 2 mile, under 20 min -> ignored
            _best_effort("r1", 5000, 1578),  # 5 km, sustained -> anchor
            _best_effort("r1", 10000, 3607),  # 10 km, sub-maximal
        ]
    )
    db_session.commit()

    assert estimate_threshold_pace(db_session, "a1") == 331


def test_estimate_falls_back_to_runs_without_best_efforts(db_session):
    # No best efforts -> median pace of the fastest sustained runs is the proxy.
    db_session.add(_run("r1", 6000, 1800))  # 5:00/km, 30 min (fastest)
    db_session.add(_run("r2", 6000, 1860))  # ~5:10/km
    db_session.add(_run("r3", 6000, 2160))  # 6:00/km
    db_session.commit()

    pace = estimate_threshold_pace(db_session, "a1")
    assert pace == 310  # median of [300, 310, 360]


def test_estimate_returns_none_without_data(db_session):
    assert estimate_threshold_pace(db_session, "a1") is None

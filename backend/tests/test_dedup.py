from __future__ import annotations

import csv
from datetime import datetime
from pathlib import Path

from app.domain.dedup import activities_match, compute_dedup_key
from app.ingestion.importer import import_export
from app.models import Activity


def test_identical_inputs_produce_same_key():
    start = datetime(2024, 4, 1, 6, 0, 0)
    a = compute_dedup_key("Run", start, 10000.0, 3000)
    b = compute_dedup_key("Run", start, 10000.0, 3000)
    assert a == b
    assert a is not None


def test_small_differences_collapse_onto_same_key():
    start = datetime(2024, 4, 1, 6, 0, 12)  # +12 s, same minute bucket
    base = compute_dedup_key("Run", datetime(2024, 4, 1, 6, 0, 0), 10000.0, 3000)
    near = compute_dedup_key("Run", start, 10040.0, 3010)  # +40 m, +10 s
    assert base == near


def test_different_sport_differs():
    start = datetime(2024, 4, 1, 6, 0, 0)
    run = compute_dedup_key("Run", start, 10000.0, 3000)
    ride = compute_dedup_key("Ride", start, 10000.0, 3000)
    assert run != ride


def test_different_start_minute_differs():
    a = compute_dedup_key("Run", datetime(2024, 4, 1, 6, 0, 0), 10000.0, 3000)
    b = compute_dedup_key("Run", datetime(2024, 4, 1, 6, 5, 0), 10000.0, 3000)
    assert a != b


def test_large_distance_difference_differs():
    start = datetime(2024, 4, 1, 6, 0, 0)
    short = compute_dedup_key("Run", start, 5000.0, 3000)
    long = compute_dedup_key("Run", start, 10000.0, 3000)
    assert short != long


def test_missing_start_returns_none():
    assert compute_dedup_key("Run", None, 10000.0, 3000) is None


def test_missing_metrics_are_treated_as_zero():
    start = datetime(2024, 4, 1, 6, 0, 0)
    a = compute_dedup_key("Run", start, None, None)
    b = compute_dedup_key("Run", start, 0.0, 0)
    assert a == b
    assert a is not None


# --- Tolerant cross-source match (activities_match) -------------------------

_BASE = datetime(2024, 4, 1, 6, 0, 0)


def test_activities_match_same_start_and_distance():
    assert activities_match(_BASE, 20000.0, _BASE, 20000.0) is True


def test_activities_match_tolerates_start_and_distance_drift():
    # The real-world bug: the same run reported ~1 min apart in start and 40 m in
    # distance (and a different moving time, which is not even an input) → match.
    a = datetime(2024, 4, 1, 6, 0, 0)
    b = datetime(2024, 4, 1, 6, 1, 0)
    assert activities_match(a, 20000.0, b, 20040.0) is True


def test_activities_match_rejects_far_apart_starts():
    b = datetime(2024, 4, 1, 6, 30, 0)
    assert activities_match(_BASE, 20000.0, b, 20000.0) is False


def test_activities_match_rejects_different_distance():
    assert activities_match(_BASE, 20000.0, _BASE, 23000.0) is False


def test_activities_match_distanceless_matches_on_start():
    # Strength/yoga: both distances zero → match on the shared start instant.
    assert activities_match(_BASE, 0.0, _BASE, 0.0) is True


def test_activities_match_requires_both_starts():
    assert activities_match(None, 100.0, _BASE, 100.0) is False
    assert activities_match(_BASE, 100.0, None, 100.0) is False


# --- End-to-end: the tolerant match across providers ------------------------

_HEADER = [
    "Activity ID",
    "Activity Date",
    "Activity Name",
    "Activity Type",
    "Elapsed Time",
    "Moving Time",
    "Distance",
    "Filename",
]


def _write_csv_export(
    folder: Path,
    activity_id: str,
    *,
    name: str,
    date: str,
    distance_m: int,
    moving_s: int,
    sport: str = "Run",
) -> None:
    """Write a summary-only (no GPX) one-activity Strava-shaped export."""
    folder.mkdir(parents=True, exist_ok=True)
    row = [
        activity_id,
        date,
        name,
        sport,
        str(moving_s),
        str(moving_s),
        str(distance_m),
        "",
    ]
    with (folder / "activities.csv").open("w", newline="", encoding="utf-8") as fh:
        writer = csv.writer(fh)
        writer.writerow(_HEADER)
        writer.writerow(row)


def test_same_workout_different_name_and_moving_time_is_deduped(db_session, tmp_path):
    # Strava "Morning Run": 20.00 km, moving 8071 s.
    strava = tmp_path / "strava"
    _write_csv_export(
        strava,
        "1001",
        name="Morning Run",
        date="Jun 7, 2026, 6:00:00 AM",
        distance_m=20000,
        moving_s=8071,
    )
    first = import_export(db_session, strava, provider="strava")
    assert first.added == 1

    # Garmin "Bensheim Running": same start, 20.04 km, moving 8023 s. Different
    # name and moving time → the exact fingerprint differs, but the tolerant
    # match recognises the same workout.
    garmin = tmp_path / "garmin"
    _write_csv_export(
        garmin,
        "2002",
        name="Bensheim Running",
        date="Jun 7, 2026, 6:00:00 AM",
        distance_m=20040,
        moving_s=8023,
    )
    second = import_export(db_session, garmin, provider="garmin")
    assert second.added == 0
    assert second.deduped == 1
    assert db_session.query(Activity).count() == 1


def test_same_source_is_never_fuzzy_deduped(db_session, tmp_path):
    # Two Strava activities with near-identical metrics but distinct ids must
    # both import - the tolerant match only applies across providers.
    a = tmp_path / "a"
    _write_csv_export(
        a,
        "1",
        name="Run A",
        date="Jun 7, 2026, 6:00:00 AM",
        distance_m=20000,
        moving_s=8071,
    )
    import_export(db_session, a, provider="strava")

    b = tmp_path / "b"
    _write_csv_export(
        b,
        "2",
        name="Run B",
        date="Jun 7, 2026, 6:00:00 AM",
        distance_m=20010,
        moving_s=8050,
    )
    summary = import_export(db_session, b, provider="strava")
    assert summary.added == 1
    assert summary.deduped == 0
    assert db_session.query(Activity).count() == 2

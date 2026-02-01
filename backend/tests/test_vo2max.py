from __future__ import annotations

from datetime import datetime, timedelta, timezone
from statistics import median
from types import SimpleNamespace

from app.domain.vo2max import (
    estimate_vo2max,
    grade_adjustment_factor,
    hr_adjusted_vo2max,
    segment_vo2max_estimates,
    vo2max_trend,
)
from app.ingestion.fit import _local_start


def _run(day: datetime, distance_m: float, moving_time_s: int, avg_hr: int):
    return SimpleNamespace(
        sport_type="Run",
        distance_m=distance_m,
        moving_time_s=moving_time_s,
        average_heart_rate=avg_hr,
        start_date_time=day,
    )


def test_hr_adjustment_lifts_easy_runs_above_raw_vdot():
    # 10 km in 60 min (easy 6:00/km) at a comfortable 140 bpm. The raw VDOT
    # treats this as a race and under-reads; the HR-reserve method recovers a
    # realistic VO2max in the mid-40s.
    raw = estimate_vo2max(10_000, 3600)
    adjusted = hr_adjusted_vo2max(10_000, 3600, 140, 190, 50)
    assert raw is not None and adjusted is not None
    assert adjusted > raw
    assert 42 <= adjusted <= 50


def test_hr_adjusted_requires_full_hr_config():
    assert hr_adjusted_vo2max(10_000, 3600, 140, None, None) is None
    assert hr_adjusted_vo2max(10_000, 3600, None, 190, 50) is None


def test_trend_is_smooth_and_rises_with_fitness():
    # 12 weekly 10 km runs at a constant 150 bpm whose pace steadily improves →
    # the estimate should rise, but the curve must evolve gradually (no steps).
    base = datetime(2024, 5, 1, 7, 0, 0)
    activities = [_run(base + timedelta(weeks=i), 10_000, 3200 - i * 40, 150) for i in range(12)]
    trend = vo2max_trend(activities, max_hr=190, resting_hr=50)
    values = [p["vo2max"] for p in trend]
    assert len(values) == 12
    assert values[-1] > values[0]  # fitness rose
    steps = [abs(values[i] - values[i - 1]) for i in range(1, len(values))]
    assert max(steps) <= 2.5  # smooth, no jumps


def test_trend_rejects_single_anomalous_spike():
    base = datetime(2024, 5, 1, 7, 0, 0)
    steady = [_run(base + timedelta(days=3 * i), 10_000, 3000, 160) for i in range(10)]
    baseline = vo2max_trend(steady, max_hr=190, resting_hr=50)[-1]["vo2max"]
    # Inject one freak run (10 km in 35 min at the same HR - a downhill / GPS
    # artifact) once there is enough surrounding context.
    spiked = list(steady)
    spiked.insert(6, _run(base + timedelta(days=16), 10_000, 2100, 160))
    after = vo2max_trend(spiked, max_hr=190, resting_hr=50)[-1]["vo2max"]
    assert abs(after - baseline) < 1.0  # the spike barely moves the line


def test_trend_forgets_peak_after_window_expires():
    base = datetime(2024, 5, 1, 7, 0, 0)
    activities = [
        _run(base, 12_000, 2880, 165),  # high estimate
        _run(base + timedelta(days=60), 6_000, 2400, 145),  # well past the window
    ]
    trend = vo2max_trend(activities, max_hr=190, resting_hr=50, window_days=42)
    # Once the strong effort drops out of the window, the envelope follows the
    # more recent, lower fitness.
    assert trend[-1]["vo2max"] < trend[0]["vo2max"]


def test_trend_falls_back_to_pace_only_without_hr():
    base = datetime(2024, 5, 1, 7, 0, 0)
    activities = [_run(base, 10_000, 2400, None)]  # 10 km in 40 min, no HR
    trend = vo2max_trend(activities, max_hr=None, resting_hr=None)
    assert len(trend) == 1
    assert trend[0]["vo2max"] > 0


def _steady_streams(
    n: int = 360,
    step_s: int = 5,
    v_m_s: float = 200 / 60,  # 200 m/min ~ 5:00/km
    hr: int = 155,
    grade: float = 0.0,
) -> dict[str, list]:
    """Synthetic streams for a constant-pace, constant-HR run on a fixed grade."""
    distance_m = [i * v_m_s * step_s for i in range(n)]
    return {
        "time": [i * step_s for i in range(n)],
        "distance": distance_m,
        "heartrate": [hr] * n,
        "altitude": [grade * d for d in distance_m],
    }


def test_grade_adjustment_factor_directions():
    assert grade_adjustment_factor(0.0) == 1.0
    assert grade_adjustment_factor(0.10) > 1.0  # uphill costs more
    assert grade_adjustment_factor(-0.05) < 1.0  # gentle descent costs less
    # Clamped beyond +/-30% so steep grades reuse the boundary value.
    assert grade_adjustment_factor(0.5) == grade_adjustment_factor(0.30)


def test_segment_estimates_steady_run_in_expected_band():
    est = segment_vo2max_estimates(_steady_streams(), max_hr=190, resting_hr=50)
    assert len(est) >= 5
    assert all(45 <= e <= 51 for e in est)


def test_segment_estimates_grade_adjustment_raises_uphill():
    flat = median(segment_vo2max_estimates(_steady_streams(grade=0.0), 190, 50))
    uphill = median(segment_vo2max_estimates(_steady_streams(grade=0.05), 190, 50))
    # Same pace and HR but climbing -> grade adjustment recovers a higher VO2max.
    assert uphill > flat + 10


def test_segment_estimates_require_hr_config_and_data():
    assert segment_vo2max_estimates(_steady_streams(), None, None) == []
    assert segment_vo2max_estimates({"time": [0, 5], "distance": [0, 16]}, 190, 50) == []


def test_trend_uses_segment_streams_when_available():
    base = datetime(2024, 5, 1, 7, 0, 0)
    activities = [
        SimpleNamespace(
            activity_id=f"a{i}",
            sport_type="Run",
            distance_m=10_000,
            moving_time_s=3600,
            average_heart_rate=155,
            start_date_time=base + timedelta(weeks=i),
        )
        for i in range(4)
    ]
    streams = {a.activity_id: _steady_streams() for a in activities}
    trend = vo2max_trend(activities, max_hr=190, resting_hr=50, streams=streams)
    assert len(trend) == 4
    assert all(44 <= p["vo2max"] <= 52 for p in trend)


def test_local_start_applies_fit_timezone_offset():
    start_utc = datetime(2026, 6, 19, 4, 42, 38)
    activity_utc = datetime(2026, 6, 19, 4, 42, 38, tzinfo=timezone.utc)
    activity_local = datetime(2026, 6, 19, 6, 42, 38, tzinfo=timezone.utc)  # +2h
    local = _local_start(start_utc, activity_utc, activity_local)
    assert local == datetime(2026, 6, 19, 6, 42, 38)


def test_local_start_missing_offset_returns_none():
    start_utc = datetime(2026, 6, 19, 4, 42, 38)
    assert _local_start(start_utc, None, None) is None

from __future__ import annotations

from datetime import datetime

from app.api.serializers import serialize_activity_detail
from app.domain.streams_analysis import (
    grade_adjusted_velocity_stream,
    mean_max_hr_curve,
)
from app.enums import SportType
from app.models import Activity


def test_mean_max_hr_curve_spans_peak_to_average_and_is_non_increasing():
    # 1 Hz stream, 10 min: easy first half (130 bpm), hard second half (170 bpm).
    time_s = list(range(0, 601))
    heart_rate = [130 if t < 300 else 170 for t in time_s]

    curve = mean_max_hr_curve({"time": time_s, "heartrate": heart_rate})

    assert curve, "curve should not be empty"
    durations = [d for d, _ in curve]
    bpms = [b for _, b in curve]

    # Only standard windows that fit within the activity, in ascending order.
    assert all(d <= 600 for d in durations)
    assert durations == sorted(durations)
    # Monotonically non-increasing by definition of a mean-maximal curve.
    assert all(a >= b for a, b in zip(bpms, bpms[1:], strict=False))
    # Short windows sit at the peak; the longest window trends toward the mean.
    assert max(bpms) >= 168
    assert bpms[-1] < max(bpms)


def test_mean_max_hr_curve_handles_missing_or_short_streams():
    assert mean_max_hr_curve({}) == []
    assert mean_max_hr_curve({"time": [0, 1], "heartrate": []}) == []
    assert mean_max_hr_curve({"time": [0], "heartrate": [150]}) == []


def test_mean_max_hr_curve_skips_sub_resolution_windows():
    # Coarse 150 s sampling: windows shorter than the resolution are dropped.
    time_s = [0, 150, 300, 450, 600]
    heart_rate = [100, 200, 100, 200, 100]

    curve = mean_max_hr_curve({"time": time_s, "heartrate": heart_rate})

    assert curve
    assert all(d >= 300 for d, _ in curve)


def _gap_streams(altitude: list[float], n: int = 20) -> dict[str, list]:
    return {
        "time": list(range(n)),
        "distance": [10.0 * i for i in range(n)],
        "altitude": altitude,
        "velocity_smooth": [3.0] * n,
    }


def test_grade_adjusted_velocity_flat_matches_raw_speed():
    # No gradient -> the flat-equivalent speed equals the raw speed.
    gap = grade_adjusted_velocity_stream(_gap_streams([100.0] * 20))

    assert gap is not None
    assert all(abs(g - 3.0) < 1e-9 for g in gap)


def test_grade_adjusted_velocity_speeds_up_uphill_and_slows_downhill():
    # +1 m per 10 m horizontal = +10% grade; -0.5 m per 10 m = -5% grade.
    uphill = grade_adjusted_velocity_stream(_gap_streams([1.0 * i for i in range(20)]))
    downhill = grade_adjusted_velocity_stream(_gap_streams([-0.5 * i for i in range(20)]))

    assert uphill is not None and downhill is not None
    # Interior samples reflect the steady grade (edges see a partial window).
    assert uphill[10] > 3.0  # a slow climb equals a faster flat effort
    assert downhill[10] < 3.0  # a gentle descent equals a slower flat effort


def test_grade_adjusted_velocity_requires_velocity_distance_altitude():
    base = _gap_streams([1.0 * i for i in range(20)])

    assert grade_adjusted_velocity_stream({}) is None
    assert (
        grade_adjusted_velocity_stream({k: v for k, v in base.items() if k != "altitude"}) is None
    )
    assert (
        grade_adjusted_velocity_stream({k: v for k, v in base.items() if k != "distance"}) is None
    )
    assert (
        grade_adjusted_velocity_stream({k: v for k, v in base.items() if k != "velocity_smooth"})
        is None
    )


def test_grade_adjusted_velocity_preserves_stops_and_gaps():
    streams = _gap_streams([1.0 * i for i in range(4)], n=4)
    streams["velocity_smooth"] = [3.0, None, 0.0, 3.0]

    gap = grade_adjusted_velocity_stream(streams)

    assert gap is not None
    assert gap[1] is None  # missing samples stay missing
    assert gap[2] == 0.0  # a stop stays a stop


def _detail_activity(sport: SportType) -> Activity:
    return Activity(
        activity_id="a1",
        start_date_time=datetime(2024, 4, 1, 7, 0, 0),
        sport_type=sport.value,
        activity_type=sport.activity_type.value,
        name="Test",
        distance_m=10000.0,
        elevation_m=100.0,
        moving_time_s=3600,
        elapsed_time_s=3700,
        is_commute=False,
    )


def test_serialize_detail_adds_gap_stream_for_runs():
    streams = _gap_streams([1.0 * i for i in range(20)])

    detail = serialize_activity_detail(_detail_activity(SportType.RUN), streams, [])

    assert "grade_adjusted_velocity" in detail.streams
    assert len(detail.streams["grade_adjusted_velocity"]) == 20


def test_serialize_detail_omits_gap_stream_for_non_runs():
    streams = _gap_streams([1.0 * i for i in range(20)])

    detail = serialize_activity_detail(_detail_activity(SportType.RIDE), streams, [])

    assert "grade_adjusted_velocity" not in detail.streams

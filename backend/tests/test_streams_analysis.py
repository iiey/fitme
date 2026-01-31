from __future__ import annotations

from app.domain.streams_analysis import mean_max_hr_curve


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

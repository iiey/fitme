from __future__ import annotations

from app.domain.vo2max import grade_adjustment_factor
from app.enums import StreamType

# Durations (seconds) for the peak-power-output widget.
PEAK_POWER_DURATIONS = [5, 30, 60, 300, 1200]

# Window durations (seconds) sampled for the mean-maximal heart-rate curve.
HR_CURVE_DURATIONS = [
    1,
    2,
    5,
    10,
    15,
    30,
    60,
    120,
    300,
    600,
    1200,
    1800,
    2700,
    3600,
    5400,
    7200,
    10800,
    14400,
    18000,
]


def peak_power_for_duration(time_s: list[int], watts: list[float], duration: int) -> float | None:
    """Maximum average power sustained over any window of >= ``duration`` seconds."""
    return _max_average_for_duration(time_s, watts, duration)


def peak_power_outputs(streams: dict[str, list]) -> dict[int, float]:
    time_s = streams.get(StreamType.TIME.value) or []
    watts = streams.get(StreamType.WATTS.value) or []
    if not time_s or not watts:
        return {}
    outputs: dict[int, float] = {}
    for duration in PEAK_POWER_DURATIONS:
        peak = peak_power_for_duration(time_s, watts, duration)
        if peak is not None:
            outputs[duration] = round(peak)
    return outputs


def _max_average_for_duration(
    time_s: list[float], values: list[float], duration: int
) -> float | None:
    """Highest time-weighted average of ``values`` over any window of
    >= ``duration`` seconds.

    The average is weighted by elapsed time (trapezoidal integration over the
    window), not by sample count, so it stays correct on the irregularly-sampled
    streams that GPX/TCX exports produce - a cluster of closely-spaced samples
    no longer biases the result.
    """
    n = min(len(time_s), len(values))
    if n == 0:
        return None

    # area[k] is the cumulative trapezoidal integral of value over time from
    # sample 0 to sample k; a window's integral is area[end] - area[start].
    area = [0.0] * n
    for i in range(1, n):
        dt = time_s[i] - time_s[i - 1]
        area[i] = area[i - 1] + ((values[i] or 0.0) + (values[i - 1] or 0.0)) / 2 * dt

    best: float | None = None
    start = 0
    for end in range(n):
        while time_s[end] - time_s[start] > duration and start < end:
            start += 1
        elapsed = time_s[end] - time_s[start]
        if elapsed >= duration * 0.9 and elapsed > 0:
            avg = (area[end] - area[start]) / elapsed
            if best is None or avg > best:
                best = avg
    return best


def mean_max_hr_curve(streams: dict[str, list]) -> list[tuple[int, int]]:
    """Mean-maximal heart-rate curve: best sustained average HR per duration.

    Returns ``(duration_s, bpm)`` pairs for every standard window that fits
    within the activity, where ``bpm`` is the highest average heart rate held
    over any window of that length. The curve is monotonically non-increasing
    by construction: shorter windows capture peaks, longer windows are pulled
    toward the activity's overall average.
    """
    time_s = streams.get(StreamType.TIME.value) or []
    heart_rate = streams.get(StreamType.HEART_RATE.value) or []
    n = min(len(time_s), len(heart_rate))
    if n < 2:
        return []

    total = time_s[n - 1] - time_s[0]
    if total <= 0:
        return []

    # Ignore windows shorter than the stream's effective sampling resolution:
    # downsampled streams otherwise yield unreliable, jagged short-duration points.
    min_duration = 2 * total / (n - 1)

    curve: list[tuple[int, int]] = []
    prev: int | None = None
    for duration in HR_CURVE_DURATIONS:
        if duration > total:
            break
        if duration < min_duration:
            continue
        best = _max_average_for_duration(time_s, heart_rate, duration)
        if best is None:
            continue
        bpm = round(best)
        # The true curve is non-increasing in duration; clamp discretisation noise.
        if prev is not None:
            bpm = min(bpm, prev)
        prev = bpm
        curve.append((duration, bpm))
    return curve


def time_in_hr_zones(streams: dict[str, list], zone_lower_bounds: list[int]) -> list[int]:
    """Seconds spent in each of the 5 heart-rate zones for one activity."""
    time_s = streams.get(StreamType.TIME.value) or []
    heart_rate = streams.get(StreamType.HEART_RATE.value) or []
    zones = [0] * 5
    if not time_s or not heart_rate:
        return zones

    n = min(len(time_s), len(heart_rate))
    for i in range(1, n):
        hr = heart_rate[i]
        if hr is None:
            continue
        delta = max(0, time_s[i] - time_s[i - 1])
        zones[_zone_index(hr, zone_lower_bounds)] += delta
    return zones


def _zone_index(hr: float, zone_lower_bounds: list[int]) -> int:
    """Map a heart-rate value to a 0-based zone index (5 zones)."""
    # zone_lower_bounds holds the lower bounds of zones 1..5 (length 5).
    zone = 0
    for index, lower in enumerate(zone_lower_bounds):
        if hr >= lower:
            zone = index
    return min(zone, 4)


def time_in_pace_zones(streams: dict[str, list], zone_boundaries: list[float]) -> list[int]:
    """Seconds spent in each of the 5 pace zones for one activity.

    *zone_boundaries* holds 4 pace values (s/km) in descending order,
    defining the cutoffs between zones 1-2, 2-3, 3-4, and 4-5.
    """
    time_s = streams.get(StreamType.TIME.value) or []
    velocity = streams.get(StreamType.VELOCITY.value) or []
    zones = [0] * 5
    if not time_s or not velocity:
        return zones

    n = min(len(time_s), len(velocity))
    for i in range(1, n):
        v = velocity[i]
        if v is None or v <= 0:
            continue
        pace_s_km = 1000.0 / v
        delta = max(0, time_s[i] - time_s[i - 1])
        zones[_pace_zone_index(pace_s_km, zone_boundaries)] += delta
    return zones


def _pace_zone_index(pace_s_km: float, boundaries: list[float]) -> int:
    """Map a pace (s/km) to a 0-based zone index (5 zones).

    *boundaries* are 4 values in descending order (slowest to fastest).
    Slower pace (higher s/km) maps to a lower zone index.
    """
    for i, bound in enumerate(boundaries):
        if pace_s_km > bound:
            return i
    return 4


# ── Grade Adjusted Pace (GAP) ──
# The stream key under which the derived grade-adjusted speed is exposed in the
# activity-detail streams payload (a flat-equivalent companion to "velocity_smooth").
GRADE_ADJUSTED_VELOCITY_STREAM = "grade_adjusted_velocity"

# Horizontal distance (metres) over which the local gradient is averaged. A
# shorter window tracks GPS altitude jitter; ~30 m smooths the noise while still
# following real undulations.
GAP_GRADE_WINDOW_M = 30.0


def _local_grade(
    distance_m: list[float | None],
    altitude_m: list[float | None],
    i: int,
    n: int,
) -> float:
    """Local gradient (rise / run) around sample ``i`` over ~``GAP_GRADE_WINDOW_M``.

    Returns ``0.0`` (treated as flat) when the surrounding samples lack the
    distance/altitude needed to form a window.
    """
    di = distance_m[i]
    if di is None:
        return 0.0

    half = GAP_GRADE_WINDOW_M / 2.0
    lo = i
    while lo > 0 and distance_m[lo - 1] is not None and (di - distance_m[lo - 1]) < half:
        lo -= 1
    hi = i
    while hi < n - 1 and distance_m[hi + 1] is not None and (distance_m[hi + 1] - di) < half:
        hi += 1

    d_lo, d_hi = distance_m[lo], distance_m[hi]
    a_lo, a_hi = altitude_m[lo], altitude_m[hi]
    if d_lo is None or d_hi is None or a_lo is None or a_hi is None:
        return 0.0
    run = d_hi - d_lo
    if run <= 0:
        return 0.0
    return (a_hi - a_lo) / run


def grade_adjusted_velocity_stream(
    streams: dict[str, list],
) -> list[float | None] | None:
    """Per-sample grade-adjusted speed (m/s): the flat-equivalent speed for the
    same effort.

    For every sample the local gradient is estimated over a short distance
    window and the raw speed is scaled by the Minetti slope-cost factor: uphill
    samples speed up (a slow climb equals a faster flat effort) and gentle
    descents slow down. Returns ``None`` when velocity, distance or altitude is
    missing (e.g. treadmill runs), so callers can hide the GAP view.
    """
    velocity = streams.get(StreamType.VELOCITY.value) or []
    distance = streams.get(StreamType.DISTANCE.value) or []
    altitude = streams.get(StreamType.ALTITUDE.value) or []
    n = len(velocity)
    if n == 0 or len(distance) < n or len(altitude) < n:
        return None

    result: list[float | None] = []
    for i in range(n):
        v = velocity[i]
        if v is None or v <= 0:
            result.append(v)
            continue
        grade = _local_grade(distance, altitude, i, n)
        result.append(round(v * grade_adjustment_factor(grade), 3))
    return result

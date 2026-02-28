"""Estimate VO2max (aerobic fitness) from running activities.

VO2max is how much oxygen the body can use at full effort - the higher, the
fitter. We never measure it in a lab, so we infer it from how fast you run
versus how hard your heart is working.

Two estimation paths
--------------------
1. Heart-rate path (preferred). At a steady effort the share of heart-rate
   reserve in use equals the share of VO2max in use, so we take the oxygen cost
   of your pace and divide by that share to recover full VO2max. Works for any
   run, not just races.
2. Pace-only path (fallback, no HR data). Jack Daniels' VDOT formula maps pace
   and duration to VO2max, assuming a near race-level effort, so it under-reads
   easy runs by design.

Two accuracy refinements (heart-rate path)
------------------------------------------
- Grade adjustment: hills raise heart rate without meaning lower fitness. Each
  uphill/downhill step is converted to its flat-equivalent effort with the
  Minetti (2002) running-cost curve, so terrain no longer skews the estimate.
- Segment analysis: instead of one whole-run average, a short window slides
  across the run, VO2max is estimated on each steady block, and the median is
  taken. This drops warm-up, stops, and erratic stretches automatically.

Trend smoothing
---------------
Per run we keep the best daily estimate, take a robust 42-day rolling upper
envelope (a lone freak run is rejected), then exponentially smooth it. The
result is a stable, gradually evolving curve - like the VO2max trend a sports
watch shows - rather than a jagged per-run series.
"""

from __future__ import annotations

import math
from datetime import date
from statistics import median

from app.enums import StreamType

# Running sport types eligible for a VO2max estimate.
RUNNING_TYPES = {"Run", "Trail Run", "VirtualRun", "TrailRun"}

# Trailing window (days) over which the displayed VO2max reflects the athlete's
# best recent aerobic capacity - mirroring how sports watches report a slowly
# evolving number rather than a per-run value.
VO2MAX_WINDOW_DAYS = 42

# Exponential smoothing factor applied to the trailing envelope so the curve
# evolves gradually (like a Garmin/Firstbeat trend) instead of stepping.
VO2MAX_SMOOTHING = 0.25

# A single trailing sample sitting more than this ratio above the next-highest,
# with enough surrounding context, is treated as an artifact (a downhill run or
# a dropped HR strap) and discarded from the envelope.
_ANOMALY_MIN_SAMPLES = 5
_ANOMALY_RATIO = 1.06

# Per-run estimate guard rails.
_MIN_DURATION_MIN = 8.0
_MIN_VELOCITY_M_MIN = 100.0  # ~6:00 m/km walk/jog floor
_MAX_VELOCITY_M_MIN = 400.0  # filters GPS spikes / sprints
_MIN_HRR_FRACTION = 0.55  # below this the effort is too easy to be informative
_MAX_HRR_FRACTION = 1.0
_MIN_VO2MAX = 25.0
_MAX_VO2MAX = 80.0

# ── Grade adjustment (item 1) ──
# Minetti et al. (2002) measured the energy cost of running up and down slopes.
# Taken relative to the flat cost it converts any gradient into an equivalent
# flat effort, so hills no longer distort the pace-based VO2.
_MINETTI_FLAT_COST = 3.6  # J/kg/m on level ground (reference)
_MAX_GRADE = 0.30  # clamp to +/-30%; beyond this the polynomial is unreliable

# ── Segment analysis (item 3) ──
# Rather than averaging a whole run, slide a short window across it, estimate
# VO2max on each steady block, and take the median - so warm-up, stops and
# erratic terrain stop dragging the number around.
SEGMENT_WINDOW_S = 300  # 5-minute analysis window
SEGMENT_STEP_S = 150  # advance 2.5 min between windows (50% overlap)
_MIN_SEGMENT_SAMPLES = 10  # need enough points for a stable average
_MAX_PACE_CV = 0.18  # reject windows whose pace varies too much (intervals/stops)


def _vo2_at_velocity(v_m_min: float) -> float:
    """Daniels' running VO2 cost (ml/kg/min) at velocity ``v`` (m/min)."""
    return -4.60 + 0.182258 * v_m_min + 0.000104 * v_m_min * v_m_min


def grade_adjustment_factor(grade: float) -> float:
    """Flat-equivalent effort multiplier for running at ``grade`` (rise / run).

    Derived from the Minetti (2002) running-cost polynomial: about 1.0 on the
    flat, greater than 1 uphill (more oxygen per metre) and less than 1 on
    gentle descents. The grade is clamped to +/-30% to stay within range.
    """
    g = max(-_MAX_GRADE, min(_MAX_GRADE, grade))
    cost = 155.4 * g**5 - 30.4 * g**4 - 43.3 * g**3 + 46.3 * g**2 + 19.5 * g + _MINETTI_FLAT_COST
    return cost / _MINETTI_FLAT_COST


def estimate_vo2max(distance_m: float, moving_time_s: int) -> float | None:
    """Return estimated VO2max (ml/kg/min) for a single running effort.

    This is the race-equivalent VDOT and assumes a near-maximal effort; it
    under-reads for easy training runs. Used as a fallback when heart-rate data
    is unavailable (see :func:`hr_adjusted_vo2max`).
    """
    if distance_m <= 0 or moving_time_s <= 0:
        return None
    t = moving_time_s / 60.0  # minutes
    v = distance_m / t  # m/min

    if t < 3 or v < 50 or v > 450:
        return None

    vo2 = _vo2_at_velocity(v)
    pct_max = 0.8 + 0.1894393 * math.exp(-0.012778 * t) + 0.2989558 * math.exp(-0.1932605 * t)
    if pct_max <= 0:
        return None
    vo2max = vo2 / pct_max
    if vo2max < 15 or vo2max > 100:
        return None
    return round(vo2max, 1)


def hr_adjusted_vo2max(
    distance_m: float | None,
    moving_time_s: int | None,
    avg_hr: int | None,
    max_hr: int | None,
    resting_hr: int | None,
) -> float | None:
    """VO2max from a sub-maximal run using the heart-rate-reserve fraction.

    At steady state the VO2 demanded by the running pace represents a fraction
    of VO2max equal to the fraction of heart-rate reserve being used. Dividing
    the pace's VO2 cost by that fraction recovers an estimate of full VO2max,
    which - unlike the raw VDOT - does not collapse for easy runs.
    """
    if not distance_m or not moving_time_s or not avg_hr or not max_hr or not resting_hr:
        return None
    if max_hr <= resting_hr:
        return None
    t = moving_time_s / 60.0
    if t < _MIN_DURATION_MIN:
        return None
    v = distance_m / t
    if v < _MIN_VELOCITY_M_MIN or v > _MAX_VELOCITY_M_MIN:
        return None
    hrr_fraction = (avg_hr - resting_hr) / (max_hr - resting_hr)
    if hrr_fraction < _MIN_HRR_FRACTION or hrr_fraction > _MAX_HRR_FRACTION:
        return None
    vo2max = _vo2_at_velocity(v) / hrr_fraction
    if vo2max < _MIN_VO2MAX or vo2max > _MAX_VO2MAX:
        return None
    return round(vo2max, 1)


def _grade_adjusted_distance(
    distance_m: list[float], altitude_m: list[float], i: int, j: int
) -> float:
    """Flat-equivalent distance over samples ``i..j`` using per-step gradients.

    Each small step's horizontal distance is scaled by its Minetti slope cost,
    so a climb contributes more flat-equivalent metres and a descent fewer.
    """
    total = 0.0
    for k in range(i, j):
        step = distance_m[k + 1] - distance_m[k]
        if step <= 0:
            continue
        grade = (altitude_m[k + 1] - altitude_m[k]) / step
        total += step * grade_adjustment_factor(grade)
    return total


def _segment_estimate(
    time_s: list[float],
    distance_m: list[float],
    heart_rate: list[float],
    altitude_m: list[float] | None,
    i: int,
    j: int,
    max_hr: int,
    resting_hr: int,
) -> float | None:
    """HR-reserve VO2max for one analysis window (samples ``i..j``), or ``None``.

    Returns ``None`` when the window is too fast/slow, too variable in pace, or
    its effort sits outside the informative heart-rate-reserve band.
    """
    dt = time_s[j] - time_s[i]
    dd = distance_m[j] - distance_m[i]
    if dt <= 0 or dd <= 0:
        return None
    velocity = dd / dt * 60.0  # m/min
    if velocity < _MIN_VELOCITY_M_MIN or velocity > _MAX_VELOCITY_M_MIN:
        return None

    # Pace steadiness: reject windows that are really intervals, stops or sprints.
    step_speeds = [
        (distance_m[k + 1] - distance_m[k]) / (time_s[k + 1] - time_s[k])
        for k in range(i, j)
        if time_s[k + 1] > time_s[k]
    ]
    if step_speeds:
        mean_speed = sum(step_speeds) / len(step_speeds)
        if mean_speed <= 0:
            return None
        variance = sum((s - mean_speed) ** 2 for s in step_speeds) / len(step_speeds)
        if math.sqrt(variance) / mean_speed > _MAX_PACE_CV:
            return None

    # Grade-adjust the pace to a flat-equivalent velocity when altitude is known.
    if altitude_m is not None:
        adjusted = _grade_adjusted_distance(distance_m, altitude_m, i, j)
        if adjusted > 0:
            velocity = adjusted / dt * 60.0

    window_hr = [h for h in heart_rate[i : j + 1] if h]
    if not window_hr:
        return None
    avg_hr = sum(window_hr) / len(window_hr)
    hrr_fraction = (avg_hr - resting_hr) / (max_hr - resting_hr)
    if hrr_fraction < _MIN_HRR_FRACTION or hrr_fraction > _MAX_HRR_FRACTION:
        return None

    vo2max = _vo2_at_velocity(velocity) / hrr_fraction
    if vo2max < _MIN_VO2MAX or vo2max > _MAX_VO2MAX:
        return None
    return vo2max


def segment_vo2max_estimates(
    streams: dict[str, list], max_hr: int | None, resting_hr: int | None
) -> list[float]:
    """Per-window HR-reserve VO2max estimates across a run's streams.

    Slides a :data:`SEGMENT_WINDOW_S` window in :data:`SEGMENT_STEP_S` steps over
    the activity's time/distance/heart-rate streams (grade-adjusting the pace
    when altitude is present) and returns one estimate per steady window; the
    caller typically takes the median. Returns an empty list when heart-rate
    configuration or stream data is insufficient.
    """
    if not max_hr or not resting_hr or max_hr <= resting_hr:
        return []
    time_s = streams.get(StreamType.TIME.value) or []
    distance_m = streams.get(StreamType.DISTANCE.value) or []
    heart_rate = streams.get(StreamType.HEART_RATE.value) or []
    altitude_m = streams.get(StreamType.ALTITUDE.value) or []
    n = min(len(time_s), len(distance_m), len(heart_rate))
    if n < _MIN_SEGMENT_SAMPLES:
        return []
    altitude = altitude_m if len(altitude_m) >= n else None

    estimates: list[float] = []
    start = 0
    while start < n:
        t0 = time_s[start]
        end = start
        while end + 1 < n and time_s[end + 1] - t0 <= SEGMENT_WINDOW_S:
            end += 1
        if time_s[end] - t0 >= SEGMENT_WINDOW_S * 0.8 and end - start + 1 >= _MIN_SEGMENT_SAMPLES:
            est = _segment_estimate(
                time_s, distance_m, heart_rate, altitude, start, end, max_hr, resting_hr
            )
            if est is not None:
                estimates.append(est)
        # Advance the window start by ~SEGMENT_STEP_S seconds.
        nxt = start + 1
        while nxt < n and time_s[nxt] - t0 < SEGMENT_STEP_S:
            nxt += 1
        start = nxt
    return estimates


def _robust_envelope(window_desc: list[float]) -> float:
    """Upper value of a trailing window, discarding a lone anomalous spike.

    ``window_desc`` is the window's estimates sorted high-to-low. We normally
    take the maximum, but when there is enough context and the top sample sits
    well above the second-highest, that top sample is treated as an artifact and
    skipped - so one freak run cannot prop the curve up for weeks.
    """
    top = window_desc[0]
    if len(window_desc) >= _ANOMALY_MIN_SAMPLES and top > window_desc[1] * _ANOMALY_RATIO:
        return window_desc[1]
    return top


def _activity_estimate(
    activity,
    use_hr: bool,
    max_hr: int | None,
    resting_hr: int | None,
    streams: dict[str, dict[str, list]] | None,
) -> float | None:
    """Best available single-run VO2max estimate for ``activity``.

    Prefers the grade-adjusted, segment-level method (needs HR config + streams),
    then a whole-run HR estimate, then pace-only VDOT.
    """
    if not use_hr:
        return estimate_vo2max(activity.distance_m, activity.moving_time_s)
    act_streams = None
    if streams:
        activity_id = getattr(activity, "activity_id", None)
        if activity_id is not None:
            act_streams = streams.get(activity_id)
    if act_streams:
        segments = segment_vo2max_estimates(act_streams, max_hr, resting_hr)
        if segments:
            return round(median(segments), 1)
    return hr_adjusted_vo2max(
        activity.distance_m,
        activity.moving_time_s,
        activity.average_heart_rate,
        max_hr,
        resting_hr,
    )


def vo2max_trend(
    activities,
    max_hr: int | None = None,
    resting_hr: int | None = None,
    window_days: int = VO2MAX_WINDOW_DAYS,
    smoothing: float = VO2MAX_SMOOTHING,
    streams: dict[str, dict[str, list]] | None = None,
) -> list[dict]:
    """Compute a watch-like VO2max time-series from running activities.

    Each run yields one estimate. With heart-rate data and per-activity
    ``streams`` we use the grade-adjusted, segment-level method (median of steady
    windows); otherwise we fall back to a whole-run heart-rate estimate, or the
    pace-only VDOT when the athlete has no HR configuration. We keep the best
    estimate per day, take a robust trailing-window upper envelope (rejecting
    lone spikes), then exponentially smooth it. The result is a stable,
    gradually evolving curve like the one a Garmin/Firstbeat watch reports,
    rather than a jagged per-run series or a step function that latches onto
    outliers.

    ``streams`` maps ``activity_id`` to that activity's stream dict (time,
    distance, heartrate, altitude); pass ``None`` to use whole-run estimates.
    """
    use_hr = bool(max_hr and resting_hr and max_hr > resting_hr)
    daily_best: dict[date, float] = {}
    for a in activities:
        sport = getattr(a, "sport_type", "") or ""
        if sport not in RUNNING_TYPES:
            continue
        est = _activity_estimate(a, use_hr, max_hr, resting_hr, streams)
        if est is None:
            continue
        day = a.start_date_time.date()
        if est > daily_best.get(day, 0.0):
            daily_best[day] = est

    days = sorted(daily_best)
    smoothed: float | None = None
    out: list[dict] = []
    # Slide a forward-only lower bound over the sorted days instead of rescanning
    # the whole history for each day (O(n) per day -> O(n) overall). The window is
    # days[lo..i] - those within the trailing window_days of the current day.
    lo = 0
    for i, day in enumerate(days):
        while (day - days[lo]).days >= window_days:
            lo += 1
        window = sorted(
            (daily_best[days[j]] for j in range(lo, i + 1)),
            reverse=True,
        )
        envelope = _robust_envelope(window)
        smoothed = envelope if smoothed is None else smoothed + smoothing * (envelope - smoothed)
        out.append({"date": day.isoformat(), "vo2max": round(smoothed, 1)})
    return out

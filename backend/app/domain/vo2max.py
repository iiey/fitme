"""Estimate VO2max from running activities using the Jack Daniels VDOT formula."""

from __future__ import annotations

import math
from datetime import date

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


def _vo2_at_velocity(v_m_min: float) -> float:
    """Daniels' running VO2 cost (ml/kg/min) at velocity ``v`` (m/min)."""
    return -4.60 + 0.182258 * v_m_min + 0.000104 * v_m_min * v_m_min


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


def vo2max_trend(
    activities,
    max_hr: int | None = None,
    resting_hr: int | None = None,
    window_days: int = VO2MAX_WINDOW_DAYS,
    smoothing: float = VO2MAX_SMOOTHING,
) -> list[dict]:
    """Compute a watch-like VO2max time-series from running activities.

    Each run yields a heart-rate-reserve-adjusted estimate (or the pace-only
    VDOT when the athlete has no HR configuration). We keep the best estimate
    per day, take a robust trailing-window upper envelope (rejecting lone
    spikes), then exponentially smooth it. The result is a stable, gradually
    evolving curve like the one a Garmin/Firstbeat watch reports, rather than a
    jagged per-run series or a step function that latches onto outliers.
    """
    use_hr = bool(max_hr and resting_hr and max_hr > resting_hr)
    daily_best: dict[date, float] = {}
    for a in activities:
        sport = getattr(a, "sport_type", "") or ""
        if sport not in RUNNING_TYPES:
            continue
        if use_hr:
            est = hr_adjusted_vo2max(
                a.distance_m, a.moving_time_s, a.average_heart_rate, max_hr, resting_hr
            )
        else:
            est = estimate_vo2max(a.distance_m, a.moving_time_s)
        if est is None:
            continue
        day = a.start_date_time.date()
        if est > daily_best.get(day, 0.0):
            daily_best[day] = est

    days = sorted(daily_best)
    smoothed: float | None = None
    out: list[dict] = []
    for day in days:
        window = sorted(
            (daily_best[d] for d in days if 0 <= (day - d).days < window_days),
            reverse=True,
        )
        envelope = _robust_envelope(window)
        smoothed = envelope if smoothed is None else smoothed + smoothing * (envelope - smoothed)
        out.append({"date": day.isoformat(), "vo2max": round(smoothed, 1)})
    return out

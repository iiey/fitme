"""Estimate VO2max from running activities using the Jack Daniels VDOT formula."""

from __future__ import annotations

import math
from datetime import datetime


def estimate_vo2max(distance_m: float, moving_time_s: int) -> float | None:
    """Return estimated VO2max (ml/kg/min) for a single running effort."""
    if distance_m <= 0 or moving_time_s <= 0:
        return None
    t = moving_time_s / 60.0  # minutes
    v = distance_m / t  # m/min

    if t < 3 or v < 50 or v > 450:
        return None

    vo2 = -4.60 + 0.182258 * v + 0.000104 * v * v
    pct_max = 0.8 + 0.1894393 * math.exp(-0.012778 * t) + 0.2989558 * math.exp(-0.1932605 * t)
    if pct_max <= 0:
        return None
    vo2max = vo2 / pct_max
    if vo2max < 15 or vo2max > 100:
        return None
    return round(vo2max, 1)


def vo2max_trend(activities) -> list[dict]:
    """Compute a VO2max time-series from running activities.

    Returns a list of ``{"date": ..., "vo2max": ...}`` dicts sorted by date,
    keeping only the best estimate per calendar day.
    """
    RUNNING_TYPES = {"Run", "Trail Run", "VirtualRun", "TrailRun"}
    estimates: dict[str, tuple[datetime, float]] = {}

    for a in activities:
        sport = getattr(a, "sport_type", "") or ""
        if sport not in RUNNING_TYPES:
            continue
        est = estimate_vo2max(a.distance_m, a.moving_time_s)
        if est is None:
            continue
        day = a.start_date_time.strftime("%Y-%m-%d")
        prev = estimates.get(day)
        if prev is None or est > prev[1]:
            estimates[day] = (a.start_date_time, est)

    return [{"date": day, "vo2max": val} for day, (_, val) in sorted(estimates.items())]

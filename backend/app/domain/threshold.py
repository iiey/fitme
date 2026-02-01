"""Estimate an athlete's running threshold pace from their best-effort curve.

Threshold pace is the quickest pace a runner can sustain for roughly an hour -
the divide between "comfortably hard" and "blowing up". It anchors the pace
training zones, so an inaccurate value pushes ordinary runs into the wrong zone.

We anchor the estimate on the athlete's single best *sustained* effort (their
fastest pace over any effort lasting at least ~20 minutes - long enough to be
genuinely aerobic and immune to brief GPS spikes), then translate it to a
one-hour-equivalent pace with Riegel's endurance model::

    time = a * distance ** RIEGEL_EXPONENT

Riegel (1981) captures how pace fades as a race lengthens; solving it for a
one-hour effort yields threshold pace. Anchoring on the *best* sustained effort
rather than fitting the whole curve keeps the estimate robust: longer "best
efforts" are often really easy-run segments (sub-maximal) and the shortest ones
are GPS spikes, and both are naturally discarded.
"""

from __future__ import annotations

# Riegel's running fatigue exponent. Slightly above 1 because pace fades as the
# distance grows; 1.06 is his classic, widely used value.
RIEGEL_EXPONENT = 1.06

# Threshold pace is, by definition, the pace sustainable for ~1 hour, so every
# effort is normalised to this reference duration.
THRESHOLD_REFERENCE_S = 3600

# Only efforts lasting at least this long anchor the estimate: a sustained
# effort is genuinely aerobic and cannot be produced by a brief GPS spike, so it
# is a trustworthy basis for extrapolation.
MIN_SUSTAINED_EFFORT_S = 1200  # 20 min
# Beyond this an effort is almost always a slow long run rather than a hard one;
# such points would drag the estimate sub-maximal, so they are ignored.
MAX_SUSTAINED_EFFORT_S = 5400  # 90 min

# Plausibility envelope for a human running threshold pace (s/km): roughly
# 2:30/km (world-class) to 12:00/km (walk-jog). A result outside it is rejected.
MIN_THRESHOLD_PACE_S_KM = 150
MAX_THRESHOLD_PACE_S_KM = 720


def riegel_predicted_pace(
    time_s: float, distance_m: float, reference_s: float = THRESHOLD_REFERENCE_S
) -> float:
    """Pace (s/km) the effort ``(time_s, distance_m)`` predicts for ``reference_s``.

    Applies Riegel's ``time = a * distance ** RIEGEL_EXPONENT`` to scale the
    effort to the reference duration and returns the resulting pace.
    """
    reference_distance = distance_m * (reference_s / time_s) ** (1 / RIEGEL_EXPONENT)
    return reference_s / reference_distance * 1000.0


def threshold_pace_from_best_efforts(points: list[tuple[float, float]]) -> int | None:
    """Threshold pace (s/km) from ``(time_s, distance_m)`` best efforts.

    Takes the fastest sustained effort and normalises it to a one-hour pace.
    Returns ``None`` when no sustained effort exists or the result is implausible.
    """
    sustained = [
        (t, d)
        for t, d in points
        if t > 0 and d > 0 and MIN_SUSTAINED_EFFORT_S <= t <= MAX_SUSTAINED_EFFORT_S
    ]
    if not sustained:
        return None
    # The smallest predicted pace comes from the most maximal effort; any
    # sub-maximal long runs in the list predict slower paces and are ignored.
    best_pace = min(riegel_predicted_pace(t, d) for t, d in sustained)
    pace_s_km = round(best_pace)
    if not MIN_THRESHOLD_PACE_S_KM <= pace_s_km <= MAX_THRESHOLD_PACE_S_KM:
        return None
    return pace_s_km

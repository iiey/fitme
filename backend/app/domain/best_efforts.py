from __future__ import annotations

from app.enums import ActivityType, SportType, StreamType

# Standard "best effort" distances (metres) per broad activity type.
RUN_DISTANCES = [400, 805, 1000, 1609, 3219, 5000, 10000, 15000, 21097, 42195]
RIDE_DISTANCES = [1000, 5000, 10000, 20000, 50000, 100000]

DISTANCE_LABELS = {
    400: "400 m",
    805: "½ mile",
    1000: "1 km",
    1609: "1 mile",
    3219: "2 mile",
    5000: "5 km",
    10000: "10 km",
    15000: "15 km",
    20000: "20 km",
    21097: "½ Marathon",
    42195: "Marathon",
    50000: "50 km",
    100000: "100 km",
}


def best_effort_distances(sport_type: SportType) -> list[int]:
    if sport_type.activity_type == ActivityType.RUN:
        return RUN_DISTANCES
    if sport_type.activity_type == ActivityType.RIDE:
        return RIDE_DISTANCES
    return []


# Upper bound on a believable speed (m/s) per broad activity type. A
# per-sample increment implying a speed above this is a GPS glitch - a teleport
# in the trace that fabricates phantom distance - so it is clamped away before
# any effort is measured. Running 10 m/s sits just past the 400 m world-record
# pace (9.3 m/s): unreachable by amateurs yet safe for the fastest humans.
# Cycling 30 m/s (108 km/h) leaves headroom for fast descents while still
# rejecting teleport glitches (which imply hundreds of m/s).
MAX_PLAUSIBLE_RUN_SPEED_MS = 10.0
MAX_PLAUSIBLE_RIDE_SPEED_MS = 30.0
_DEFAULT_MAX_PLAUSIBLE_SPEED_MS = 12.0


def _max_plausible_speed(sport_type: SportType) -> float:
    if sport_type.activity_type == ActivityType.RUN:
        return MAX_PLAUSIBLE_RUN_SPEED_MS
    if sport_type.activity_type == ActivityType.RIDE:
        return MAX_PLAUSIBLE_RIDE_SPEED_MS
    return _DEFAULT_MAX_PLAUSIBLE_SPEED_MS


def _clean_distance_stream(
    distances: list[float], times: list[float], max_speed_ms: float
) -> list[float]:
    """Cumulative distance with GPS-glitch jumps removed.

    Walks the trace and caps each step to ``max_speed_ms`` over its own elapsed
    time: a spurious jump (e.g. +400 m in 1 s) is reduced to a plausible step,
    so it can no longer fabricate an impossibly fast best effort. Backwards
    steps (another glitch shape) are clamped to zero. Plausible steps are left
    untouched, so genuine efforts are unaffected.
    """
    cleaned = [distances[0]]
    for i in range(1, len(distances)):
        delta_d = distances[i] - distances[i - 1]
        delta_t = times[i] - times[i - 1]
        max_step = max_speed_ms * delta_t if delta_t > 0 else 0.0
        cleaned.append(cleaned[-1] + min(max(delta_d, 0.0), max_step))
    return cleaned


def compute_best_efforts(
    streams: dict[str, list], sport_type: SportType
) -> list[tuple[int, float]]:
    """Fastest time (s) to cover each standard distance, via a sliding window.

    Returns a list of ``(distance_m, time_s)`` for every standard distance that
    fits within the activity. GPS-glitch jumps are removed first so a spurious
    distance spike cannot produce an impossibly fast effort.
    """
    if not sport_type.supports_best_efforts:
        return []

    distances = streams.get(StreamType.DISTANCE.value) or []
    times = streams.get(StreamType.TIME.value) or []
    if len(distances) < 2 or len(times) != len(distances):
        return []

    distances = _clean_distance_stream(distances, times, _max_plausible_speed(sport_type))
    total = distances[-1]
    results: list[tuple[int, float]] = []
    for target in best_effort_distances(sport_type):
        if target > total:
            break
        best = _fastest_window(distances, times, target)
        if best is not None:
            results.append((target, best))
    return results


def _fastest_window(distances: list[float], times: list[float], target: float) -> float | None:
    """Minimum elapsed time over any contiguous window covering >= ``target`` m."""
    n = len(distances)
    start = 0
    best: float | None = None
    for end in range(1, n):
        # Shrink the window from the left while it still covers the target.
        while start < end and distances[end] - distances[start + 1] >= target:
            start += 1
        if distances[end] - distances[start] >= target:
            elapsed = times[end] - times[start]
            if elapsed > 0 and (best is None or elapsed < best):
                best = elapsed
    return best

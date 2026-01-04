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


def compute_best_efforts(
    streams: dict[str, list], sport_type: SportType
) -> list[tuple[int, float]]:
    """Fastest time (s) to cover each standard distance, via a sliding window.

    Returns a list of ``(distance_m, time_s)`` for every standard distance that
    fits within the activity.
    """
    if not sport_type.supports_best_efforts:
        return []

    distances = streams.get(StreamType.DISTANCE.value) or []
    times = streams.get(StreamType.TIME.value) or []
    if len(distances) < 2 or len(times) != len(distances):
        return []

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

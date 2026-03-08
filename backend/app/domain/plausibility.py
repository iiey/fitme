"""Physical-plausibility constraints for activities.

A single recording glitch - a GPS fix that teleports across the map, a dropped
fix at "null island" (0, 0), or a best effort implying superhuman pace - can
poison derived features: it draws a spurious line across the heatmap and fakes
an unbeatable best effort. This module holds the constraint functions that
detect such physically impossible outcomes so callers can exclude them:

* :func:`route_is_suspect` - flags a GPS trace with an impossible jump or an
  invalid coordinate, used to drop the activity from the heatmap;
* :func:`best_effort_is_plausible` - rejects an effort whose average speed
  exceeds what the sport allows, used to drop it from best-effort tables.

The speed caps are the single source of truth reused by the best-effort
computation to clamp per-sample GPS glitches.
"""

from __future__ import annotations

from app.domain.math_utils import haversine_distance
from app.enums import ActivityType, SportType

# Upper bound on a believable speed (m/s) per broad activity type. A value above
# this is not a real effort but a GPS glitch - a teleport in the trace that
# fabricates phantom distance. Running 10 m/s sits just past the 400 m
# world-record pace (9.3 m/s): unreachable by amateurs yet safe for the fastest
# humans. Cycling 30 m/s (108 km/h) leaves headroom for fast descents while
# still rejecting teleport glitches (which imply hundreds of m/s).
MAX_PLAUSIBLE_RUN_SPEED_MS = 10.0
MAX_PLAUSIBLE_RIDE_SPEED_MS = 30.0
_DEFAULT_MAX_PLAUSIBLE_SPEED_MS = 12.0

# Coordinates this close (in degrees) to (0, 0) are treated as a dropped fix
# ("null island" in the Gulf of Guinea), a common GPS-error artifact rather
# than a real position.
_NULL_ISLAND_DEG = 0.1

# A single hop between consecutive GPS fixes longer than this is a teleport even
# when the activity's own distance is unknown or wrong: no real activity records
# a 2 km straight-line gap between adjacent fixes.
MIN_TELEPORT_JUMP_M = 2000.0


def max_plausible_speed(sport_type: SportType) -> float:
    """Fastest believable speed (m/s) for the sport's broad activity type."""
    if sport_type.activity_type == ActivityType.RUN:
        return MAX_PLAUSIBLE_RUN_SPEED_MS
    if sport_type.activity_type == ActivityType.RIDE:
        return MAX_PLAUSIBLE_RIDE_SPEED_MS
    return _DEFAULT_MAX_PLAUSIBLE_SPEED_MS


def _is_valid_coordinate(lat: float, lng: float) -> bool:
    """Whether ``(lat, lng)`` is a real WGS84 fix rather than a GPS error."""
    if not (-90.0 <= lat <= 90.0 and -180.0 <= lng <= 180.0):
        return False
    # A fix at (0, 0) is almost always a dropped signal, not the Gulf of Guinea.
    return not (abs(lat) < _NULL_ISLAND_DEG and abs(lng) < _NULL_ISLAND_DEG)


def route_is_suspect(coords: list[list[float] | None], total_distance_m: float) -> bool:
    """Whether a GPS trace contains a physically impossible jump or bad fix.

    A trace is suspect when any fix is off the map (out of range or at null
    island) or when a single hop between consecutive fixes is longer than the
    whole activity - a jump that exceeds the total distance travelled cannot be
    real. ``MIN_TELEPORT_JUMP_M`` floors the threshold so an activity whose
    reported distance is missing or wrong is still guarded. Traces with fewer
    than two fixes carry no route and are never suspect.
    """
    points = [p for p in coords if p]
    if len(points) < 2:
        return False

    teleport_cap = max(total_distance_m, MIN_TELEPORT_JUMP_M)
    prev: list[float] | None = None
    for point in points:
        lat, lng = point[0], point[1]
        if not _is_valid_coordinate(lat, lng):
            return True
        if prev is not None and haversine_distance(prev[0], prev[1], lat, lng) > teleport_cap:
            return True
        prev = point
    return False


def best_effort_is_plausible(distance_m: float, time_s: float, sport_type: SportType) -> bool:
    """Whether covering ``distance_m`` in ``time_s`` is humanly possible.

    Rejects efforts whose implied average speed exceeds the sport's cap - a
    residual GPS glitch surviving stream cleaning, or a bad summary, that would
    otherwise fake an unbeatable record.
    """
    if time_s <= 0:
        return False
    return distance_m / time_s <= max_plausible_speed(sport_type)

"""Content-based activity fingerprinting for cross-source de-duplication.

Different providers (Strava, Garmin, ...) assign different native ids to the
*same* physical activity, so an id comparison alone cannot detect that a
workout has already been imported from another source.

Two complementary signals are used:

1. An exact ``dedup_key`` fingerprint (broad sport + start minute + distance +
   moving time) for the common case where the providers report identical
   metrics (e.g. a Garmin activity synced verbatim to Strava).
2. A *tolerant* match (:func:`activities_match`) for when the same workout is
   reported with slightly different numbers - most often a different **moving
   time**, because providers apply different auto-pause rules. The tolerant
   match deliberately ignores moving/elapsed time and compares only the stable
   signals: the start instant (within a few minutes) and the distance (within a
   small tolerance), for the same broad sport.
"""

from __future__ import annotations

import hashlib
from datetime import datetime

# Buckets are coarse enough to absorb minor cross-source differences while
# staying far finer than the gap between two genuinely distinct activities.
_EPOCH = datetime(1970, 1, 1)
_DISTANCE_BUCKET_M = 100.0
_DURATION_BUCKET_S = 30.0

# Tolerances for the fuzzy match. The same workout from two providers shares a
# start instant (it is the same recording) but may report a slightly different
# distance; moving time is ignored entirely because it is the least comparable
# figure across providers.
_START_TOLERANCE_S = 180.0
_DISTANCE_ABS_TOL_M = 250.0
_DISTANCE_REL_TOL = 0.05


def compute_dedup_key(
    activity_type: str,
    start: datetime | None,
    distance_m: float | None,
    moving_time_s: int | None,
) -> str | None:
    """Return a content fingerprint for an activity, or ``None`` without a start.

    The fingerprint is deterministic and independent of the host timezone: the
    naive ``start`` datetime is interpreted as-is. The same ``start`` basis must
    be used for every source (the importer always derives it the same way), so
    matching keys reliably indicate the same physical activity.
    """
    if start is None:
        return None
    minute = int((start - _EPOCH).total_seconds() // 60)
    dist_bucket = int(round((distance_m or 0.0) / _DISTANCE_BUCKET_M))
    move_bucket = int(round((moving_time_s or 0) / _DURATION_BUCKET_S))
    payload = f"{activity_type}|{minute}|{dist_bucket}|{move_bucket}"
    return hashlib.sha1(payload.encode("utf-8")).hexdigest()


def activities_match(
    start_a: datetime | None,
    distance_a: float | None,
    start_b: datetime | None,
    distance_b: float | None,
) -> bool:
    """Whether two same-sport activities are the same physical workout.

    Compares only the cross-source-stable signals - the start instant (within a
    few minutes) and the distance (within a small tolerance). Moving/elapsed time
    is intentionally ignored: providers compute pauses differently, which is the
    main reason the same workout previously escaped de-duplication. Callers must
    ensure both activities already share the same broad ``activity_type``.

    Distance-less activities (e.g. strength training, where both distances are
    ``0``) match on start time alone, which is correct: two same-sport sessions
    cannot start within a few minutes of each other unless they are the same one.
    """
    if start_a is None or start_b is None:
        return False
    if abs((start_a - start_b).total_seconds()) > _START_TOLERANCE_S:
        return False
    da = distance_a or 0.0
    db = distance_b or 0.0
    tolerance = max(_DISTANCE_ABS_TOL_M, _DISTANCE_REL_TOL * max(da, db))
    return abs(da - db) <= tolerance

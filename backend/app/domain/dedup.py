"""Content-based activity fingerprinting for cross-source de-duplication.

Different providers (Strava, Garmin, ...) assign different native ids to the
*same* physical activity, so an id comparison alone cannot detect that a
workout has already been imported from another source. Instead we derive a
``dedup_key`` from immutable physical properties of the activity:

* the broad sport (``activity_type``),
* the start time bucketed to the minute,
* the distance bucketed to ~100 m,
* the moving time bucketed to ~30 s.

Two records that describe the same workout collapse onto the same key, even
when their ids, names and provider differ. The buckets absorb the small
rounding differences that arise when two providers report the same activity.
"""

from __future__ import annotations

import hashlib
from datetime import datetime

# Buckets are coarse enough to absorb minor cross-source differences while
# staying far finer than the gap between two genuinely distinct activities.
_EPOCH = datetime(1970, 1, 1)
_DISTANCE_BUCKET_M = 100.0
_DURATION_BUCKET_S = 30.0


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

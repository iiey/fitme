from __future__ import annotations

from datetime import datetime, timezone


def utcnow() -> datetime:
    """Return the current UTC time as a naive ``datetime``.

    The codebase stores naive UTC timestamps throughout (every ingestion
    parser strips ``tzinfo`` before persisting). This is the drop-in,
    behaviour-preserving replacement for the deprecated
    ``datetime.utcnow()``: it computes the time in a timezone-aware way and
    then drops the offset so the returned value stays naive UTC.
    """
    return datetime.now(timezone.utc).replace(tzinfo=None)

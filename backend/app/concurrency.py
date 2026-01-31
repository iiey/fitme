"""Process-wide coordination for write-heavy ingestion jobs.

Bulk imports and Intervals.icu syncs both perform long sequences of writes
against the same SQLite database. Running two of them at once risks interleaved
writes and duplicate work, so they share a single non-reentrant lock: whoever
holds it has exclusive ownership of the ingestion write path. Callers acquire it
non-blocking and surface a "busy" response rather than queueing.
"""

from __future__ import annotations

import threading

# Held for the duration of a bulk import or a sync run. Acquire non-blocking.
import_lock = threading.Lock()

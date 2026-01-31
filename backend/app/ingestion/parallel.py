"""Parallel parsing of activity files (FIT/GPX/TCX) for fast bulk imports.

Parsing FIT files is CPU-bound and dominates the cost of a large Garmin import
(thousands of files). Python's GIL means threads cannot speed this up, so we
fan the work out across a ``ProcessPoolExecutor``. The pool is created once per
import and reused across batches; for small imports (few files) it is skipped
entirely to avoid process-startup overhead.

The pool uses the ``spawn`` start method rather than ``fork``: the import runs
inside a background thread of the web server, and forking a multi-threaded
process can deadlock. ``spawn`` is slightly slower to start but safe. Every
operation degrades gracefully to serial parsing if the pool cannot be created
or a batch fails, so an import never breaks because of the optimisation.
"""

from __future__ import annotations

import logging
import multiprocessing as mp
import os
from concurrent.futures import ProcessPoolExecutor

from app.ingestion.fit import parse_fit
from app.ingestion.gpx import parse_gpx
from app.ingestion.parsed import ParsedActivityFile
from app.ingestion.tcx import parse_tcx

logger = logging.getLogger("fitme.import")

# A unit of parse work: (key, file_bytes, extension).
ParseItem = tuple[str, bytes, str]
# A parse result: (key, parsed_or_none, error_flag).
ParseResult = tuple[str, "ParsedActivityFile | None", bool]

_MAX_WORKERS_CAP = 8


def _parse_one(item: ParseItem) -> ParseResult:
    """Parse a single file by extension. Runs in a worker process."""
    key, data, ext = item
    try:
        if ext == "gpx":
            parsed = parse_gpx(data)
        elif ext == "tcx":
            parsed = parse_tcx(data)
        elif ext == "fit":
            parsed = parse_fit(data)
        else:
            return (key, None, False)
        return (key, parsed, False)
    except Exception:  # noqa: BLE001 - a bad file must not abort the batch.
        return (key, None, True)


class FileParser:
    """Parses batches of activity files, in parallel when worthwhile.

    Use as a context manager so the worker pool is created once and cleaned up
    deterministically::

        with FileParser(enabled=len(files) >= 16) as parser:
            for batch in batches:
                results = parser.parse_batch(batch)
    """

    def __init__(self, *, enabled: bool, max_workers: int | None = None):
        self._enabled = enabled
        self._max_workers = max_workers or min(os.cpu_count() or 4, _MAX_WORKERS_CAP)
        self._pool: ProcessPoolExecutor | None = None

    def __enter__(self) -> FileParser:
        if self._enabled:
            try:
                self._pool = ProcessPoolExecutor(
                    max_workers=self._max_workers,
                    mp_context=mp.get_context("spawn"),
                )
            except Exception:  # noqa: BLE001 - fall back to serial parsing.
                logger.warning("Parallel parser unavailable; parsing serially.")
                self._pool = None
        return self

    def __exit__(self, *exc) -> None:
        if self._pool is not None:
            self._pool.shutdown(wait=True)
            self._pool = None

    def parse_batch(self, items: list[ParseItem]) -> list[ParseResult]:
        if not items:
            return []
        if self._pool is None:
            return [_parse_one(item) for item in items]
        try:
            return list(self._pool.map(_parse_one, items, chunksize=4))
        except Exception:  # noqa: BLE001 - degrade to serial on pool failure.
            logger.warning("Parallel parse batch failed; retrying serially.")
            return [_parse_one(item) for item in items]

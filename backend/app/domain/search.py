from __future__ import annotations

import calendar
import re
from dataclasses import dataclass, field
from datetime import datetime

from app.enums import ActivityType, SportType

# Date tokens accepted in the fuzzy search box: YYYY, YYYY-MM, YYYY-MM-DD
# (also tolerating "/" as a separator).
_YEAR_RE = re.compile(r"^(\d{4})$")
_YEAR_MONTH_RE = re.compile(r"^(\d{4})[-/](\d{1,2})$")
_YEAR_MONTH_DAY_RE = re.compile(r"^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$")


@dataclass
class SportTerm:
    """A search token that names a sport type (e.g. ``"trail"`` -> ``TrailRun``).

    It matches an activity whose ``sport_type`` is one of ``sport_types`` *or*
    whose name contains ``token``. The name fallback is what makes a trail run
    that was logged as a plain ``Run`` still show up when searching "trail".
    """

    token: str
    sport_types: list[str]


@dataclass
class ParsedSearch:
    """Structured filters extracted from a free-text search string."""

    sport_terms: list[SportTerm] = field(default_factory=list)
    start: datetime | None = None
    end: datetime | None = None
    terms: list[str] = field(default_factory=list)

    @property
    def sport_types(self) -> list[str]:
        """Every sport-type value referenced by the parsed sport tokens."""
        values: set[str] = set()
        for sport_term in self.sport_terms:
            values.update(sport_term.sport_types)
        return sorted(values)


def _end_of_day(year: int, month: int, day: int) -> datetime:
    return datetime(year, month, day, 23, 59, 59)


def _date_range_from_token(token: str) -> tuple[datetime, datetime] | None:
    """Resolve a date token to an inclusive ``(start, end)`` datetime range."""
    match = _YEAR_MONTH_DAY_RE.match(token)
    if match:
        year, month, day = int(match[1]), int(match[2]), int(match[3])
        try:
            start = datetime(year, month, day)
        except ValueError:
            return None
        return start, _end_of_day(year, month, day)

    match = _YEAR_MONTH_RE.match(token)
    if match:
        year, month = int(match[1]), int(match[2])
        if not 1 <= month <= 12:
            return None
        last_day = calendar.monthrange(year, month)[1]
        return datetime(year, month, 1), _end_of_day(year, month, last_day)

    match = _YEAR_RE.match(token)
    if match:
        year = int(match[1])
        # Keep plausible 4-digit years; avoids treating e.g. distances as dates.
        if 1990 <= year <= 2100:
            return datetime(year, 1, 1), _end_of_day(year, 12, 31)

    return None


def _sport_matches(token: str) -> set[str]:
    """Sport-type values whose name/category contains the (lowercased) token."""
    needle = token.lower()
    matched: set[str] = set()

    for activity_type in ActivityType:
        if needle == activity_type.value.lower() or needle in activity_type.label.lower():
            matched.update(
                sport.value for sport in SportType if sport.activity_type is activity_type
            )

    for sport in SportType:
        if needle in sport.value.lower() or needle in sport.label.lower():
            matched.add(sport.value)

    return matched


def parse_activity_search(text: str | None) -> ParsedSearch:
    """Split a search string into date, sport and free-text filters.

    Example: ``"2025-12 run morning"`` →
    ``ParsedSearch(sport_terms=[SportTerm("run", [Run, TrailRun, VirtualRun])],
                   start=2025-12-01, end=2025-12-31, terms=["morning"])``.
    """
    parsed = ParsedSearch()
    if not text:
        return parsed

    for token in text.split():
        date_range = _date_range_from_token(token)
        if date_range:
            parsed.start, parsed.end = date_range
            continue

        sports = _sport_matches(token)
        if sports:
            # Match on the sport type OR the name, so a "Trail Run" logged as a
            # plain Run is still found when the typed word names a sport.
            parsed.sport_terms.append(SportTerm(token=token, sport_types=sorted(sports)))
            continue

        parsed.terms.append(token)

    return parsed

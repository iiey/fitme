from __future__ import annotations

from datetime import datetime

from app.domain.search import parse_activity_search


def test_parse_year_month_and_sport():
    parsed = parse_activity_search("2025-12 run")
    assert parsed.start == datetime(2025, 12, 1, 0, 0, 0)
    assert parsed.end == datetime(2025, 12, 31, 23, 59, 59)
    assert "Run" in parsed.sport_types
    assert "TrailRun" in parsed.sport_types
    assert parsed.terms == []


def test_parse_year_only():
    parsed = parse_activity_search("2024")
    assert parsed.start == datetime(2024, 1, 1, 0, 0, 0)
    assert parsed.end == datetime(2024, 12, 31, 23, 59, 59)


def test_parse_full_date():
    parsed = parse_activity_search("2025-12-25")
    assert parsed.start == datetime(2025, 12, 25, 0, 0, 0)
    assert parsed.end == datetime(2025, 12, 25, 23, 59, 59)


def test_parse_ride_matches_all_ride_sports():
    parsed = parse_activity_search("ride")
    assert "Ride" in parsed.sport_types
    assert "GravelRide" in parsed.sport_types
    assert "MountainBikeRide" in parsed.sport_types


def test_free_text_terms_are_kept():
    parsed = parse_activity_search("morning commute")
    assert parsed.sport_types == []
    assert parsed.start is None
    assert parsed.terms == ["morning", "commute"]


def test_implausible_year_is_treated_as_text():
    parsed = parse_activity_search("1234")
    # 1234 is outside the plausible activity-year range, so it's free text.
    assert parsed.start is None
    assert parsed.terms == ["1234"]


def test_invalid_month_is_not_a_date():
    parsed = parse_activity_search("2025-13")
    assert parsed.start is None
    assert "2025-13" in parsed.terms

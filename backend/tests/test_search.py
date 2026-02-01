from __future__ import annotations

from datetime import datetime

from app import repository
from app.domain.search import parse_activity_search
from app.models import Activity


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


def test_sport_word_is_kept_for_name_fallback():
    # "trail" names the TrailRun sport, but the token must NOT be discarded: it
    # still has to match activities whose name contains "trail".
    parsed = parse_activity_search("trail")
    assert [term.token for term in parsed.sport_terms] == ["trail"]
    assert "TrailRun" in parsed.sport_terms[0].sport_types
    assert parsed.terms == []


def _add_run(db, activity_id: str, name: str, sport_type: str = "Run") -> None:
    db.add(
        Activity(
            activity_id=activity_id,
            athlete_id="42",
            name=name,
            sport_type=sport_type,
            activity_type="Run",
            start_date_time=datetime(2024, 4, 1, 6, 0, 0),
        )
    )


def _search(db, text: str) -> list[Activity]:
    """Run a fuzzy search exactly like the activities API wires it up."""
    parsed = parse_activity_search(text)
    return repository.list_activities(
        db,
        "42",
        name_terms=parsed.terms,
        sport_or_name_terms=[(term.sport_types, term.token) for term in parsed.sport_terms],
    )


def test_trail_run_logged_as_run_is_found(db_session):
    # The reported bug: a trail run stored with sport_type "Run" (no TrailRun
    # rows exist) must still appear when searching "trail".
    _add_run(db_session, "1", "Morning Trail Run")
    _add_run(db_session, "2", "Easy Run")
    db_session.commit()

    found = _search(db_session, "trail")
    assert {a.name for a in found} == {"Morning Trail Run"}


def test_sport_word_still_matches_by_sport_type(db_session):
    # A genuine TrailRun is matched by sport type even if its name lacks "trail".
    _add_run(db_session, "1", "Hill repeats", sport_type="TrailRun")
    _add_run(db_session, "2", "Easy Run")
    db_session.commit()

    found = _search(db_session, "trail")
    assert {a.name for a in found} == {"Hill repeats"}

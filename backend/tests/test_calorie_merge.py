from __future__ import annotations

from datetime import datetime

from app.enums import StreamType
from app.ingestion.export import CsvActivityRow
from app.ingestion.parsed import ParsedActivityFile
from app.ingestion.upsert import canonical_metrics, upsert_activity


def _row(calories: int | None) -> CsvActivityRow:
    return CsvActivityRow(
        activity_id="999",
        name="Half Marathon",
        activity_date_raw="2026-05-15 06:45:18",
        sport_type_raw="Run",
        description=None,
        filename=None,
        is_commute=False,
        gear_name=None,
        distance_m=21336.0,
        elapsed_time_s=8835,
        moving_time_s=8835,
        elevation_gain_m=10.0,
        max_speed_ms=4.0,
        average_speed_ms=2.4,
        average_heart_rate=140,
        max_heart_rate=170,
        average_cadence=None,
        max_cadence=None,
        average_power=None,
        max_power=None,
        calories=calories,
        start_utc=datetime(2026, 5, 15, 4, 45, 18),
    )


def _parsed(calories: int | None) -> ParsedActivityFile:
    return ParsedActivityFile(
        streams={
            StreamType.TIME.value: [0, 60],
            StreamType.DISTANCE.value: [0.0, 200.0],
        },
        start_time=datetime(2026, 5, 15, 4, 45, 18),
        start_time_local=datetime(2026, 5, 15, 6, 45, 18),
        sport_type="Run",
        calories=calories,
    )


def _upsert(db, row: CsvActivityRow, parsed: ParsedActivityFile | None):
    canonical = canonical_metrics(row, parsed)
    return upsert_activity(
        db,
        row,
        parsed,
        source_hash="hash",
        current=None,
        athlete_id="athlete1",
        provider="garmin",
        external_id="999",
        dedup_key=None,
        canonical=canonical,
    )


def test_file_calories_win_over_inflated_summary(db_session):
    # Garmin's bulk-export summary reports energy in kilojoules (~4.184x too
    # high); the device's FIT ``total_calories`` is the correct kcal figure.
    activity = _upsert(db_session, _row(4852), _parsed(1158))
    assert activity.calories == 1158


def test_summary_calories_used_without_a_file(db_session):
    activity = _upsert(db_session, _row(1158), None)
    assert activity.calories == 1158

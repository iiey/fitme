from __future__ import annotations

import csv
from pathlib import Path

from app.ingestion.importer import import_export
from app.models import Activity, BestEffort, Gear

GPX_TEMPLATE = """<?xml version="1.0"?>
<gpx xmlns="http://www.topografix.com/GPX/1/1">
<trk><type>running</type><trkseg>
<trkpt lat="50.0000" lon="4.0000"><ele>100</ele><time>2024-04-01T06:00:00Z</time></trkpt>
<trkpt lat="50.0090" lon="4.0000"><ele>110</ele><time>2024-04-01T06:05:00Z</time></trkpt>
<trkpt lat="50.0180" lon="4.0000"><ele>120</ele><time>2024-04-01T06:10:00Z</time></trkpt>
</trkseg></trk></gpx>"""


def _write_export(folder: Path) -> None:
    (folder / "activities").mkdir(parents=True, exist_ok=True)
    (folder / "activities" / "1.gpx").write_text(GPX_TEMPLATE, encoding="utf-8")
    header = [
        "Activity ID",
        "Activity Date",
        "Activity Name",
        "Activity Type",
        "Elapsed Time",
        "Moving Time",
        "Distance",
        "Average Heart Rate",
        "Commute",
        "Activity Gear",
        "Filename",
    ]
    row = [
        "1",
        "Apr 1, 2024, 6:00:00 AM",
        "Morning Run",
        "Run",
        "600",
        "600",
        "2000",
        "150",
        "false",
        "My Shoes",
        "activities/1.gpx",
    ]
    with (folder / "activities.csv").open("w", newline="", encoding="utf-8") as fh:
        writer = csv.writer(fh)
        writer.writerow(header)
        writer.writerow(row)


def test_import_is_idempotent(db_session, tmp_path):
    export = tmp_path / "export"
    _write_export(export)

    first = import_export(db_session, export)
    assert first.added == 1
    assert first.skipped == 0
    assert db_session.query(Activity).count() == 1
    assert db_session.query(Gear).count() == 1
    assert db_session.query(BestEffort).count() >= 1

    # Re-importing the same export must skip the unchanged activity.
    second = import_export(db_session, export)
    assert second.added == 0
    assert second.updated == 0
    assert second.skipped == 1
    assert db_session.query(Activity).count() == 1


def test_import_updates_changed_activity(db_session, tmp_path):
    export = tmp_path / "export"
    _write_export(export)
    import_export(db_session, export)

    # Change the activity name in the CSV and re-import.
    csv_path = export / "activities.csv"
    content = csv_path.read_text().replace("Morning Run", "Renamed Run")
    csv_path.write_text(content)

    summary = import_export(db_session, export)
    assert summary.updated == 1
    assert summary.added == 0
    activity = db_session.query(Activity).one()
    assert activity.name == "Renamed Run"


def test_import_parses_athlete_profile(db_session, tmp_path):
    from app.models import AthleteProfile

    export = tmp_path / "export"
    _write_export(export)
    header = ["Athlete ID", "First Name", "Last Name", "City", "Country"]
    row = ["987654", "Sam", "Runner", "Ghent", "Belgium"]
    with (export / "profile.csv").open("w", newline="", encoding="utf-8") as fh:
        writer = csv.writer(fh)
        writer.writerow(header)
        writer.writerow(row)

    import_export(db_session, export)

    profile = db_session.get(AthleteProfile, "987654")
    assert profile is not None
    assert profile.first_name == "Sam"
    assert profile.last_name == "Runner"
    assert profile.city == "Ghent"


def test_import_without_profile_csv_is_fine(db_session, tmp_path):
    from app.models import AthleteProfile

    export = tmp_path / "export"
    _write_export(export)
    import_export(db_session, export)
    assert db_session.query(AthleteProfile).count() == 0

"""Tests for cross-provider athlete merging and the source-identity mapping."""

from __future__ import annotations

import csv
from pathlib import Path

from app.ingestion.importer import import_export
from app.models import Activity, AthleteProfile, SourceIdentity


def _gpx(date_iso: str) -> str:
    """A 3-point GPX track whose UTC start is ``date_iso`` (e.g. 2024-04-01)."""
    return f"""<?xml version="1.0"?>
<gpx xmlns="http://www.topografix.com/GPX/1/1">
<trk><type>running</type><trkseg>
<trkpt lat="50.0000" lon="4.0000"><ele>100</ele><time>{date_iso}T06:00:00Z</time></trkpt>
<trkpt lat="50.0090" lon="4.0000"><ele>110</ele><time>{date_iso}T06:05:00Z</time></trkpt>
<trkpt lat="50.0180" lon="4.0000"><ele>120</ele><time>{date_iso}T06:10:00Z</time></trkpt>
</trkseg></trk></gpx>"""


_HEADER = [
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


def _write_export(
    folder: Path,
    activity_id: str,
    *,
    athlete_id: str,
    name: str,
    date: str,
    gpx_date: str = "2024-04-01",
) -> None:
    """Write a one-activity export with a profile.csv for the given athlete."""
    (folder / "activities").mkdir(parents=True, exist_ok=True)
    (folder / "activities" / f"{activity_id}.gpx").write_text(_gpx(gpx_date), encoding="utf-8")
    row = [
        activity_id,
        date,
        "Morning Run",
        "Run",
        "600",
        "600",
        "2000",
        "150",
        "false",
        "",
        f"activities/{activity_id}.gpx",
    ]
    with (folder / "activities.csv").open("w", newline="", encoding="utf-8") as fh:
        writer = csv.writer(fh)
        writer.writerow(_HEADER)
        writer.writerow(row)
    first, _, last = name.partition(" ")
    with (folder / "profile.csv").open("w", newline="", encoding="utf-8") as fh:
        writer = csv.writer(fh)
        writer.writerow(["Athlete ID", "First Name", "Last Name"])
        writer.writerow([athlete_id, first, last])


def test_new_import_records_self_mapping(db_session, tmp_path):
    export = tmp_path / "strava"
    _write_export(export, "1", athlete_id="987", name="Sam Runner", date="Apr 1, 2024, 6:00:00 AM")
    import_export(db_session, export, provider="strava")

    mapping = db_session.get(SourceIdentity, ("strava", "987"))
    assert mapping is not None
    assert mapping.athlete_id == "987"
    activity = db_session.query(Activity).one()
    assert activity.athlete_id == "987"


def test_merge_into_existing_athlete(db_session, tmp_path):
    # A Strava athlete already exists.
    strava = tmp_path / "strava"
    _write_export(strava, "1", athlete_id="987", name="Sam Runner", date="Apr 1, 2024, 6:00:00 AM")
    import_export(db_session, strava, provider="strava")

    # A Garmin export of the same person, merged into the Strava athlete.
    garmin = tmp_path / "garmin"
    _write_export(
        garmin,
        "555",
        athlete_id="142219879",
        name="Sam Runner",
        date="Apr 2, 2024, 6:00:00 AM",
        gpx_date="2024-04-02",
    )
    import_export(db_session, garmin, provider="garmin", target_athlete_id="987")

    # Both activities live under the Strava athlete; no separate Garmin athlete.
    assert db_session.get(AthleteProfile, "142219879") is None
    activities = db_session.query(Activity).all()
    assert {a.athlete_id for a in activities} == {"987"}
    assert {a.source for a in activities} == {"strava", "garmin"}

    # The merge is remembered for next time.
    mapping = db_session.get(SourceIdentity, ("garmin", "142219879"))
    assert mapping is not None
    assert mapping.athlete_id == "987"


def test_sticky_mapping_auto_targets_on_reimport(db_session, tmp_path):
    strava = tmp_path / "strava"
    _write_export(strava, "1", athlete_id="987", name="Sam Runner", date="Apr 1, 2024, 6:00:00 AM")
    import_export(db_session, strava, provider="strava")

    garmin = tmp_path / "garmin"
    _write_export(
        garmin,
        "555",
        athlete_id="142219879",
        name="Sam Runner",
        date="Apr 2, 2024, 6:00:00 AM",
        gpx_date="2024-04-02",
    )
    # First Garmin import merges explicitly.
    import_export(db_session, garmin, provider="garmin", target_athlete_id="987")

    # A later Garmin import WITHOUT a target reuses the remembered mapping.
    import_export(db_session, garmin, provider="garmin")
    assert db_session.get(AthleteProfile, "142219879") is None
    assert {a.athlete_id for a in db_session.query(Activity).all()} == {"987"}


def test_merge_collapses_same_workout_across_providers(db_session, tmp_path):
    # The SAME workout (same GPX → same UTC start/distance/duration) recorded on
    # both services collapses to one row once merged under a single athlete.
    strava = tmp_path / "strava"
    _write_export(strava, "1", athlete_id="987", name="Sam Runner", date="Apr 1, 2024, 6:00:00 AM")
    import_export(db_session, strava, provider="strava")

    garmin = tmp_path / "garmin"
    _write_export(
        garmin,
        "555",
        athlete_id="142219879",
        name="Sam Runner",
        date="Apr 1, 2024, 6:00:00 AM",
    )
    summary = import_export(db_session, garmin, provider="garmin", target_athlete_id="987")
    assert summary.added == 0
    assert summary.deduped == 1
    assert db_session.query(Activity).count() == 1


def test_new_athlete_choice_overrides_sticky_mapping(db_session, tmp_path):
    strava = tmp_path / "strava"
    _write_export(strava, "1", athlete_id="987", name="Sam Runner", date="Apr 1, 2024, 6:00:00 AM")
    import_export(db_session, strava, provider="strava")

    garmin = tmp_path / "garmin"
    _write_export(
        garmin,
        "555",
        athlete_id="142219879",
        name="Sam Runner",
        date="Apr 2, 2024, 6:00:00 AM",
        gpx_date="2024-04-02",
    )
    import_export(db_session, garmin, provider="garmin", target_athlete_id="987")

    # Re-import choosing the export's own id ("a separate athlete") splits it
    # back out and updates the remembered mapping to itself.
    import_export(db_session, garmin, provider="garmin", target_athlete_id="142219879")
    assert db_session.get(AthleteProfile, "142219879") is not None
    mapping = db_session.get(SourceIdentity, ("garmin", "142219879"))
    assert mapping.athlete_id == "142219879"

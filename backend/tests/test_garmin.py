from __future__ import annotations

import io
import json
import zipfile
from datetime import datetime, timezone
from pathlib import Path

from app.enums import ActivityType, SportType
from app.ingestion.garmin import GarminExportReader, is_garmin_export
from app.ingestion.importer import import_export
from app.models import Activity, AthleteProfile

# Garmin stores distance/elevation in cm, durations in ms, and summarized
# avg/max speed at 1/10 m/s. These helpers build fixtures in those raw units.
_PROFILE_ID = 142219879

_RUN = {
    "activityId": 111,
    "userProfileId": _PROFILE_ID,
    "name": "Bensheim Running",
    "activityType": "running",
    "sportType": "RUNNING",
    # 2024-04-01 06:00:00 local wall-clock (epoch already carries the offset).
    "startTimeLocal": 1711951200000,
    "beginTimestamp": 1711944000000,
    "distance": 500000.0,  # 5000 m
    "duration": 1850000.0,  # 1850 s
    "movingDuration": 1750000.0,  # 1750 s
    "elapsedDuration": 1850000.0,
    "elevationGain": 5000.0,  # 50 m
    "avgSpeed": 0.2857,  # -> 2.857 m/s (but importer derives from dist/time)
    "maxSpeed": 0.35,  # -> 3.5 m/s
    "avgHr": 150.0,
    "maxHr": 175.0,
    "avgPower": 200.0,
    "maxPower": 320.0,
    "normPower": 210.0,
    "avgRunCadence": 85.0,
    "maxRunCadence": 95.0,
    "calories": 400.0,
    "startLatitude": 49.7044,
    "startLongitude": 8.6151,
    "manufacturer": "GARMIN",
}

_STRENGTH = {
    "activityId": 222,
    "userProfileId": _PROFILE_ID,
    "name": "Strength",
    "activityType": "strength_training",
    "sportType": "FITNESS_EQUIPMENT",
    "startTimeLocal": 1712037600000,  # 2024-04-02 06:00:00 local
    "duration": 3000000.0,  # 3000 s, no distance
    "calories": 250.0,
    "manufacturer": "GARMIN",
}


def _write_garmin_export(folder: Path, activities: list[dict]) -> None:
    fitness = folder / "DI_CONNECT" / "DI-Connect-Fitness"
    user = folder / "DI_CONNECT" / "DI-Connect-User"
    fitness.mkdir(parents=True, exist_ok=True)
    user.mkdir(parents=True, exist_ok=True)
    (fitness / "athlete_0_summarizedActivities.json").write_text(
        json.dumps([{"summarizedActivitiesExport": activities}]), encoding="utf-8"
    )
    (user / "user_profile.json").write_text(
        json.dumps({"firstName": "Minh", "lastName": "Triet Ly", "gender": "MALE"}),
        encoding="utf-8",
    )


def test_is_garmin_export_detects_layout(tmp_path):
    garmin = tmp_path / "garmin"
    _write_garmin_export(garmin, [_RUN])
    assert is_garmin_export(garmin) is True

    strava = tmp_path / "strava"
    (strava).mkdir()
    (strava / "activities.csv").write_text("Activity ID\n1\n", encoding="utf-8")
    assert is_garmin_export(strava) is False


def test_from_garmin_sport_mapping():
    assert SportType.from_garmin("running") is SportType.RUN
    assert SportType.from_garmin("trail_running") is SportType.TRAIL_RUN
    assert SportType.from_garmin("cycling") is SportType.RIDE
    assert SportType.from_garmin("strength_training") is SportType.WEIGHT_TRAINING
    assert SportType.from_garmin("walking") is SportType.WALK
    # Unknown activity type falls back to the broad sportType.
    assert SportType.from_garmin("unobtanium", "CYCLING") is SportType.RIDE
    # Wholly unknown defaults to WORKOUT.
    assert SportType.from_garmin("unobtanium", "UNKNOWN") is SportType.WORKOUT


def test_garmin_reader_converts_units(tmp_path):
    garmin = tmp_path / "garmin"
    _write_garmin_export(garmin, [_RUN])
    with GarminExportReader(garmin) as reader:
        rows = reader.read_activity_rows()
        profile = reader.read_profile()

    assert len(rows) == 1
    row = rows[0]
    assert row.activity_id == "111"
    assert row.sport_type_raw == SportType.RUN.value
    assert row.distance_m == 5000.0  # cm -> m
    assert row.moving_time_s == 1750  # ms -> s
    assert row.elevation_gain_m == 50.0  # cm -> m
    assert row.max_speed_ms == 3.5  # field * 10
    # Average speed is derived from distance / moving time.
    assert abs(row.average_speed_ms - 5000.0 / 1750.0) < 1e-6
    assert row.start_latitude == 49.7044
    assert row.parsed_date() == datetime(2024, 4, 1, 6, 0, 0)

    assert profile is not None
    assert profile.athlete_id == str(_PROFILE_ID)
    assert profile.first_name == "Minh"
    assert profile.sex == "M"


def test_import_garmin_export(db_session, tmp_path):
    garmin = tmp_path / "garmin"
    _write_garmin_export(garmin, [_RUN, _STRENGTH])

    summary = import_export(db_session, garmin)
    assert summary.added == 2
    assert summary.skipped == 0

    profile = db_session.get(AthleteProfile, str(_PROFILE_ID))
    assert profile is not None
    assert profile.first_name == "Minh"

    run = db_session.get(Activity, "garmin:111")
    assert run is not None
    assert run.source == "garmin"
    assert run.external_id == "111"
    assert run.athlete_id == str(_PROFILE_ID)
    assert run.sport_type == SportType.RUN.value
    assert run.activity_type == ActivityType.RUN.value
    assert run.distance_m == 5000.0
    assert run.elevation_m == 50.0
    assert run.moving_time_s == 1750
    assert run.average_heart_rate == 150
    assert run.average_power == 200
    assert run.normalized_power == 210.0
    assert run.start_latitude == 49.7044
    assert run.start_date_time == datetime(2024, 4, 1, 6, 0, 0)
    assert run.dedup_key is not None
    # Summary-only import: no per-activity stream file was linked.
    assert run.streams_are_imported is False

    strength = db_session.get(Activity, "garmin:222")
    assert strength is not None
    assert strength.sport_type == SportType.WEIGHT_TRAINING.value
    assert strength.distance_m == 0.0
    assert strength.moving_time_s == 3000

    # Re-importing the same export is idempotent.
    second = import_export(db_session, garmin)
    assert second.added == 0
    assert second.skipped == 2


# FIT files in a Garmin export are named by upload id, not activity id, and are
# matched back to summaries by start time. These epochs (ms, UTC) are the GMT
# starts shared by a summary and its uploaded FIT.
_GMT_RUN = 1711951200000
_GMT_STRENGTH = 1712037600000


def _fake_peek(content: bytes) -> datetime | None:
    """Stand-in for FIT parsing: map dummy bytes to a start time (or None)."""
    mapping = {
        b"FIT-ACT-RUN": datetime.fromtimestamp(_GMT_RUN / 1000, tz=timezone.utc),
        b"FIT-ACT-STR": datetime.fromtimestamp(_GMT_STRENGTH / 1000, tz=timezone.utc),
    }
    started = mapping.get(content)
    return started.replace(tzinfo=None) if started else None


def _write_garmin_export_with_fits(folder: Path) -> None:
    fitness = folder / "DI_CONNECT" / "DI-Connect-Fitness"
    uploaded = folder / "DI_CONNECT" / "DI-Connect-Uploaded-Files"
    fitness.mkdir(parents=True, exist_ok=True)
    uploaded.mkdir(parents=True, exist_ok=True)

    activities = [
        {**_RUN, "startTimeGmt": _GMT_RUN},
        {**_STRENGTH, "startTimeGmt": _GMT_STRENGTH},
    ]
    (fitness / "athlete_0_summarizedActivities.json").write_text(
        json.dumps([{"summarizedActivitiesExport": activities}]), encoding="utf-8"
    )

    # Nested archive of per-upload FIT files (two activities + one monitoring
    # file that must be ignored), named by upload id rather than activity id.
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as zf:
        zf.writestr("user_900001.fit", b"FIT-ACT-RUN")
        zf.writestr("user_900002.fit", b"FIT-ACT-STR")
        zf.writestr("user_900003.fit", b"FIT-MONITORING")
    (uploaded / "UploadedFiles_0-_Part1.zip").write_bytes(buffer.getvalue())


def test_garmin_matches_fit_files_by_start_time(tmp_path, monkeypatch):
    monkeypatch.setattr("app.ingestion.garmin.peek_activity_start", _fake_peek)
    export = tmp_path / "garmin"
    _write_garmin_export_with_fits(export)

    with GarminExportReader(export) as reader:
        rows = reader.read_activity_rows()
        by_id = {row.activity_id: row for row in rows}

        # Both summaries are linked to a FIT; the monitoring file is ignored.
        run_file = by_id["111"].filename
        strength_file = by_id["222"].filename
        assert run_file is not None
        assert strength_file is not None
        assert run_file != strength_file

        # The matched FIT resolves back to its bytes as a ``fit`` file.
        run_data, ext = reader.read_activity_file(run_file)
        assert ext == "fit"
        assert run_data == b"FIT-ACT-RUN"
        strength_data, _ = reader.read_activity_file(strength_file)
        assert strength_data == b"FIT-ACT-STR"

        # A name that was never matched does not resolve.
        assert reader.read_activity_file("user_900003.fit") is None


# A Garmin multisport outing: one ``parent`` container plus its individual legs.
_MULTISPORT_PARENT = {
    "activityId": 900,
    "userProfileId": _PROFILE_ID,
    "name": "Town Multisport",
    "activityType": "multi_sport",
    "sportType": "MULTISPORT",
    "parent": True,
    "startTimeLocal": 1712037600000,
    "startTimeGmt": 1712030400000,
    "duration": 10653000.0,
    "distance": 1515400.0,  # 15.15 km aggregate
    "manufacturer": "GARMIN",
}
_MULTISPORT_WALK = {
    "activityId": 901,
    "userProfileId": _PROFILE_ID,
    "name": "Walking 1",
    "activityType": "walking",
    "sportType": "STEPS",
    "parent": False,
    "parentId": 900,
    "startTimeLocal": 1712037600000,
    "startTimeGmt": 1712030400000,
    "duration": 6252000.0,
    "distance": 603900.0,  # 6.04 km
    "manufacturer": "GARMIN",
}
_MULTISPORT_RUN = {
    "activityId": 902,
    "userProfileId": _PROFILE_ID,
    "name": "Running",
    "activityType": "running",
    "sportType": "RUNNING",
    "parent": False,
    "parentId": 900,
    "startTimeLocal": 1712043852000,
    "startTimeGmt": 1712036652000,
    "duration": 3401000.0,
    "distance": 732500.0,  # 7.33 km
    "manufacturer": "GARMIN",
}


def test_multisport_parent_is_skipped_children_imported(tmp_path):
    export = tmp_path / "garmin"
    _write_garmin_export(export, [_MULTISPORT_PARENT, _MULTISPORT_WALK, _MULTISPORT_RUN])
    with GarminExportReader(export) as reader:
        rows = reader.read_activity_rows()
        ids = {row.activity_id for row in rows}
        count = reader.count_activities()

    # The aggregate container is dropped; only the two legs remain.
    assert "900" not in ids
    assert ids == {"901", "902"}
    assert count == 2


def test_import_multisport_does_not_double_count(db_session, tmp_path):
    export = tmp_path / "garmin"
    _write_garmin_export(export, [_MULTISPORT_PARENT, _MULTISPORT_WALK, _MULTISPORT_RUN])
    summary = import_export(db_session, export)

    # Two legs imported, parent skipped → total distance is the legs' sum, not
    # the legs plus the aggregate.
    assert summary.added == 2
    assert db_session.get(Activity, "garmin:900") is None
    assert db_session.get(Activity, "garmin:901") is not None
    assert db_session.get(Activity, "garmin:902") is not None
    total_km = sum(a.distance_m for a in db_session.query(Activity).all()) / 1000
    assert abs(total_km - (6.039 + 7.325)) < 0.01

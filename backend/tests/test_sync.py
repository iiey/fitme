from __future__ import annotations

from datetime import datetime

import pytest

from app.ingestion.intervals import SyncedActivity, summary_to_row
from app.ingestion.parsed import ParsedActivityFile
from app.ingestion.sync import PROVIDER, sync
from app.models import Activity, AthleteProfile, SourceIdentity, SyncConfig

ATHLETE_ID = "42"


def _activity_dict(
    activity_id: str,
    *,
    start_local: str,
    start_utc: str,
    sport: str = "Ride",
    distance: float = 24000.0,
    moving: int = 3600,
    name: str = "Synced ride",
    source: str | None = "GARMIN_CONNECT",
    file_type: str | None = "fit",
) -> dict:
    return {
        "id": activity_id,
        "start_date_local": start_local,
        "start_date": start_utc,
        "type": sport,
        "name": name,
        "distance": distance,
        "moving_time": moving,
        "elapsed_time": moving + 60,
        "source": source,
        "file_type": file_type,
    }


def _synced(activity: dict) -> SyncedActivity:
    from app.ingestion.intervals import normalize_origin

    return SyncedActivity(
        row=summary_to_row(activity),
        origin=normalize_origin(activity.get("source")),
        file_type=activity.get("file_type"),
    )


class FakeClient:
    """A stand-in for :class:`IntervalsClient` driven by canned data."""

    def __init__(
        self,
        activities: list[dict],
        *,
        files: dict[str, tuple[bytes, str]] | None = None,
        streams: dict[str, ParsedActivityFile] | None = None,
    ) -> None:
        self._activities = [_synced(a) for a in activities]
        self._files = files or {}
        self._streams = streams or {}
        self.list_calls = 0
        self.stream_calls: list[str] = []
        self.closed = False

    def list_activities(self, oldest, newest):  # noqa: ANN001 - test double
        self.list_calls += 1
        return list(self._activities)

    def download_original(self, activity_id: str, file_type: str | None):
        return self._files.get(activity_id)

    def get_streams(self, activity_id: str, *, start_utc=None, start_local=None):
        self.stream_calls.append(activity_id)
        return self._streams.get(activity_id)

    def close(self) -> None:
        self.closed = True


@pytest.fixture
def config(db_session):
    db_session.add(AthleteProfile(athlete_id=ATHLETE_ID, first_name="Test"))
    cfg = SyncConfig(
        provider=PROVIDER,
        athlete_id=ATHLETE_ID,
        icu_athlete_id="0",
        api_key="secret",
        enabled=True,
    )
    db_session.add(cfg)
    db_session.commit()
    return cfg


def _seed_existing(
    db_session,
    *,
    source: str,
    activity_id: str,
    start_utc: datetime,
    distance: float,
    activity_type: str = "Ride",
    sport_type: str = "Ride",
) -> Activity:
    """Insert an existing activity from another provider (a dedup twin)."""
    activity = Activity(
        activity_id=activity_id,
        athlete_id=ATHLETE_ID,
        source=source,
        external_id=activity_id,
        start_date_time=start_utc,
        start_utc=start_utc,
        sport_type=sport_type,
        activity_type=activity_type,
        name="Existing",
        distance_m=distance,
        moving_time_s=3600,
        elapsed_time_s=3660,
    )
    db_session.add(activity)
    db_session.commit()
    return activity


def test_sync_inserts_under_intervals_source(db_session, config):
    client = FakeClient(
        [
            _activity_dict(
                "i1",
                start_local="2024-11-20T07:35:18",
                start_utc="2024-11-20T06:35:18Z",
                source="GARMIN_CONNECT",
                file_type=None,
            )
        ]
    )
    summary = sync(db_session, config, client=client)

    assert summary.added == 1
    activity = db_session.get(Activity, "intervals:i1")
    assert activity is not None
    assert activity.source == "intervals"
    assert activity.external_id == "i1"
    # True origin recorded separately in import_source.
    assert activity.import_source == "intervals/garmin"
    # Watermark advanced to the activity's local start.
    db_session.refresh(config)
    assert config.synced_through == datetime(2024, 11, 20, 7, 35, 18)
    assert config.last_status == "ok"


def test_sync_records_source_identity(db_session, config):
    client = FakeClient([])
    sync(db_session, config, client=client)
    mapping = db_session.get(SourceIdentity, (PROVIDER, "0"))
    assert mapping is not None
    assert mapping.athlete_id == ATHLETE_ID


def test_resync_is_idempotent(db_session, config):
    activity = _activity_dict(
        "i1",
        start_local="2024-11-20T07:35:18",
        start_utc="2024-11-20T06:35:18Z",
    )
    first = sync(db_session, config, client=FakeClient([activity]))
    assert first.added == 1

    # Re-syncing the same unchanged activity skips it (stable-subset hash).
    second = sync(db_session, config, client=FakeClient([activity]))
    assert second.added == 0
    assert second.updated == 0
    assert second.skipped == 1
    assert db_session.query(Activity).count() == 1


def test_changed_activity_is_updated(db_session, config):
    activity = _activity_dict(
        "i1",
        start_local="2024-11-20T07:35:18",
        start_utc="2024-11-20T06:35:18Z",
        name="Original",
    )
    sync(db_session, config, client=FakeClient([activity]))

    changed = dict(activity, name="Renamed ride")
    summary = sync(db_session, config, client=FakeClient([changed]))
    assert summary.updated == 1
    assert summary.added == 0
    assert db_session.get(Activity, "intervals:i1").name == "Renamed ride"


def test_cross_source_dedup_against_existing_garmin(db_session, config):
    """A synced activity that is the same workout as an existing Garmin row is
    collapsed instead of duplicated."""
    start = datetime(2024, 11, 20, 6, 35, 18)
    _seed_existing(
        db_session,
        source="garmin",
        activity_id="garmin-1",
        start_utc=start,
        distance=24010.0,
    )

    client = FakeClient(
        [
            _activity_dict(
                "i1",
                start_local="2024-11-20T07:35:18",
                start_utc="2024-11-20T06:35:18Z",
                distance=24000.0,
                source="GARMIN_CONNECT",
            )
        ]
    )
    summary = sync(db_session, config, client=client)

    assert summary.deduped == 1
    assert summary.added == 0
    # No intervals row created; the Garmin twin remains the only activity.
    assert db_session.get(Activity, "intervals:i1") is None
    assert db_session.query(Activity).count() == 1
    # Watermark still advances over the de-duplicated window.
    db_session.refresh(config)
    assert config.synced_through == datetime(2024, 11, 20, 7, 35, 18)


def test_strava_origin_falls_back_to_streams(db_session, config):
    """Strava-origin activities have no downloadable file; detail comes from the
    streams API when available."""
    parsed = ParsedActivityFile(streams={"heartrate": [120, 130, 140, 150]})
    client = FakeClient(
        [
            _activity_dict(
                "i1",
                start_local="2024-11-20T07:35:18",
                start_utc="2024-11-20T06:35:18Z",
                source="STRAVA",
                file_type=None,
            )
        ],
        streams={"i1": parsed},
    )
    summary = sync(db_session, config, client=client)

    assert summary.added == 1
    assert summary.enriched == 1
    assert client.stream_calls == ["i1"]
    activity = db_session.get(Activity, "intervals:i1")
    assert activity.import_source == "intervals/strava"
    assert activity.streams_are_imported is True


def test_strava_origin_without_streams_is_summary_only(db_session, config):
    client = FakeClient(
        [
            _activity_dict(
                "i1",
                start_local="2024-11-20T07:35:18",
                start_utc="2024-11-20T06:35:18Z",
                source="STRAVA",
                file_type=None,
            )
        ]
    )
    summary = sync(db_session, config, client=client)
    assert summary.added == 1
    assert summary.enriched == 0
    assert db_session.get(Activity, "intervals:i1").streams_are_imported is False


def test_full_resync_updates_unchanged_activity(db_session, config):
    activity = _activity_dict(
        "i1",
        start_local="2024-11-20T07:35:18",
        start_utc="2024-11-20T06:35:18Z",
    )
    sync(db_session, config, client=FakeClient([activity]))

    # Without force the same activity would be skipped; full_resync re-applies it.
    summary = sync(db_session, config, client=FakeClient([activity]), full_resync=True)
    assert summary.skipped == 0
    assert summary.updated == 1


def test_original_file_is_parsed_when_available(db_session, config):
    gpx = b"""<?xml version="1.0"?>
<gpx xmlns="http://www.topografix.com/GPX/1/1">
<trk><type>running</type><trkseg>
<trkpt lat="50.0000" lon="4.0000"><ele>100</ele><time>2024-11-20T06:00:00Z</time></trkpt>
<trkpt lat="50.0090" lon="4.0000"><ele>110</ele><time>2024-11-20T06:05:00Z</time></trkpt>
<trkpt lat="50.0180" lon="4.0000"><ele>120</ele><time>2024-11-20T06:10:00Z</time></trkpt>
</trkseg></trk></gpx>"""
    client = FakeClient(
        [
            _activity_dict(
                "i1",
                start_local="2024-11-20T07:00:00",
                start_utc="2024-11-20T06:00:00Z",
                sport="Run",
                file_type="gpx",
            )
        ],
        files={"i1": (gpx, "gpx")},
    )
    summary = sync(db_session, config, client=client)
    assert summary.enriched == 1
    # The streams API is not consulted when the original file parses.
    assert client.stream_calls == []
    activity = db_session.get(Activity, "intervals:i1")
    assert activity.streams_are_imported is True
    assert activity.polyline is not None

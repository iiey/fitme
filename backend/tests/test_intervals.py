from __future__ import annotations

import gzip
import json

import httpx
import pytest

from app.enums import SportType, StreamType
from app.ingestion.intervals import (
    IntervalsAuthError,
    IntervalsClient,
    IntervalsError,
    import_source_for,
    normalize_origin,
    parse_datetime,
    streams_payload_to_dict,
    summary_to_row,
)

SAMPLE_ACTIVITY = {
    "id": "i55751783",
    "start_date_local": "2024-11-20T07:35:18",
    "start_date": "2024-11-20T06:35:18Z",
    "type": "Ride",
    "name": "Morning spin",
    "distance": 24050.0,
    "moving_time": 3600,
    "elapsed_time": 3720,
    "total_elevation_gain": 240.0,
    "average_heartrate": 142.4,
    "max_heartrate": 175,
    "average_speed": 6.68,
    "icu_average_watts": 180,
    "calories": 540,
    "file_type": "fit",
    "source": "GARMIN_CONNECT",
    # Volatile computed fields that must NOT affect the row fingerprint.
    "icu_fitness": 55.3,
    "icu_fatigue": 40.1,
    "icu_training_load": 78,
}


def test_summary_to_row_maps_core_fields():
    row = summary_to_row(SAMPLE_ACTIVITY)
    assert row.activity_id == "i55751783"
    assert row.name == "Morning spin"
    assert row.sport_type_raw == "Ride"
    assert row.distance_m == 24050.0
    assert row.moving_time_s == 3600
    assert row.elapsed_time_s == 3720
    assert row.elevation_gain_m == 240.0
    assert row.average_heart_rate == 142
    assert row.max_heart_rate == 175
    assert row.average_power == 180
    assert row.calories == 540
    # UTC start parsed from ``start_date`` (trailing Z dropped to naive UTC).
    assert row.start_utc is not None
    assert row.start_utc.hour == 6
    # Local wall-clock start used for display.
    assert row.parsed_date() is not None
    assert row.parsed_date().hour == 7


def test_summary_to_row_sport_type_resolves_to_strava_sport():
    row = summary_to_row(SAMPLE_ACTIVITY)
    assert SportType.from_strava(row.sport_type_raw) is SportType.RIDE


def test_row_fingerprint_ignores_volatile_fields():
    """Changing fitness/fatigue/load must not change the stable-subset hash."""
    from app.ingestion.upsert import row_hash

    base = summary_to_row(SAMPLE_ACTIVITY)
    volatile = dict(SAMPLE_ACTIVITY)
    volatile["icu_fitness"] = 99.9
    volatile["icu_fatigue"] = 12.0
    volatile["icu_training_load"] = 250
    changed = summary_to_row(volatile)
    assert row_hash(base) == row_hash(changed)

    # A material change (distance) DOES change the hash.
    material = dict(SAMPLE_ACTIVITY)
    material["distance"] = 30000.0
    assert row_hash(base) != row_hash(summary_to_row(material))


def test_normalize_origin_and_import_source():
    assert normalize_origin("GARMIN_CONNECT") == "garmin"
    assert normalize_origin("STRAVA") == "strava"
    assert normalize_origin(None) == "upload"
    assert normalize_origin("") == "upload"
    assert import_source_for("garmin") == "intervals/garmin"
    assert import_source_for("strava") == "intervals/strava"
    assert import_source_for("") == "intervals/upload"


def test_parse_datetime_handles_utc_and_local():
    assert parse_datetime("2024-11-20T06:35:18Z").hour == 6
    assert parse_datetime("2024-11-20T07:35:18").hour == 7
    assert parse_datetime("2024-11-20").day == 20
    assert parse_datetime(None) is None
    assert parse_datetime("") is None


def test_streams_payload_to_dict_list_form():
    payload = [
        {"type": "heartrate", "data": [120, 130, 140]},
        {"type": "velocity_smooth", "data": [5.0, 5.5]},
        {"type": "ignored_without_data"},
    ]
    streams = streams_payload_to_dict(payload)
    assert streams[StreamType.HEART_RATE.value] == [120, 130, 140]
    assert streams[StreamType.VELOCITY.value] == [5.0, 5.5]
    assert "ignored_without_data" not in streams


def test_streams_payload_to_dict_map_form():
    payload = {"heartrate": {"data": [120, 130]}, "watts": [200, 210]}
    streams = streams_payload_to_dict(payload)
    assert streams["heartrate"] == [120, 130]
    assert streams["watts"] == [200, 210]


# -- HTTP behaviour via a mocked transport ----------------------------------


def _client(handler) -> IntervalsClient:
    transport = httpx.MockTransport(handler)
    http = httpx.Client(transport=transport, auth=("API_KEY", "secret"))
    return IntervalsClient("secret", "0", client=http, sleep=lambda _s: None)


def test_test_connection_returns_athlete():
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/api/v1/athlete/0"
        # Basic auth header present (username API_KEY).
        assert request.headers["authorization"].startswith("Basic ")
        return httpx.Response(200, json={"id": "2049151", "name": "Test Athlete"})

    with _client(handler) as client:
        athlete = client.test_connection()
    assert athlete.id == "2049151"
    assert athlete.name == "Test Athlete"


def test_auth_error_raises():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(403, text="forbidden")

    with _client(handler) as client:
        with pytest.raises(IntervalsAuthError):
            client.test_connection()


def test_list_activities_maps_summaries():
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/api/v1/athlete/0/activities"
        assert request.url.params["oldest"] == "2024-11-01"
        assert request.url.params["newest"] == "2024-11-30"
        return httpx.Response(200, json=[SAMPLE_ACTIVITY])

    from datetime import date

    with _client(handler) as client:
        activities = client.list_activities(date(2024, 11, 1), date(2024, 11, 30))
    assert len(activities) == 1
    assert activities[0].origin == "garmin"
    assert activities[0].file_type == "fit"
    assert activities[0].row.activity_id == "i55751783"


def test_retries_on_429_then_succeeds():
    calls = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        calls["n"] += 1
        if calls["n"] == 1:
            return httpx.Response(429, headers={"Retry-After": "0"})
        return httpx.Response(200, json={"id": "0", "name": None})

    with _client(handler) as client:
        client.test_connection()
    assert calls["n"] == 2


def test_download_original_gunzips():
    raw = b"<gpx>file contents</gpx>"

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/api/v1/activity/i1/file"
        return httpx.Response(200, content=gzip.compress(raw))

    with _client(handler) as client:
        result = client.download_original("i1", "gpx")
    assert result is not None
    data, ext = result
    assert data == raw
    assert ext == "gpx"


def test_download_original_absent_returns_none():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(404)

    with _client(handler) as client:
        assert client.download_original("i1", "fit") is None


def test_download_original_skips_unknown_file_type():
    def handler(request: httpx.Request) -> httpx.Response:  # pragma: no cover
        raise AssertionError("no HTTP call expected for unknown file type")

    with _client(handler) as client:
        assert client.download_original("i1", None) is None
        assert client.download_original("i1", "csv") is None


def test_get_streams_returns_parsed_file():
    payload = [{"type": "heartrate", "data": [120, 130, 140]}]

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/api/v1/activity/i1/streams"
        return httpx.Response(200, json=payload)

    with _client(handler) as client:
        parsed = client.get_streams("i1")
    assert parsed is not None
    assert parsed.streams["heartrate"] == [120, 130, 140]


def test_get_streams_404_returns_none():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(404)

    with _client(handler) as client:
        assert client.get_streams("i1") is None


def test_server_error_raises_after_retries():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(500, text="boom")

    with _client(handler) as client:
        with pytest.raises(IntervalsError):
            client.test_connection()


def test_non_list_activities_response_raises():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, content=json.dumps({"oops": True}).encode())

    from datetime import date

    with _client(handler) as client:
        with pytest.raises(IntervalsError):
            client.list_activities(date(2024, 1, 1), date(2024, 1, 2))

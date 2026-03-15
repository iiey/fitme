from __future__ import annotations

import csv
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.db import Base, get_db
from app.ingestion.importer import import_export
from app.main import app

GPX = """<?xml version="1.0"?>
<gpx xmlns="http://www.topografix.com/GPX/1/1">
<trk><type>running</type><trkseg>
<trkpt lat="50.0000" lon="4.0000"><ele>100</ele><time>2024-04-01T06:00:00Z</time></trkpt>
<trkpt lat="50.0090" lon="4.0000"><ele>110</ele><time>2024-04-01T06:05:00Z</time></trkpt>
<trkpt lat="50.0180" lon="4.0000"><ele>120</ele><time>2024-04-01T06:10:00Z</time></trkpt>
</trkseg></trk></gpx>"""


@pytest.fixture
def client(tmp_path: Path):
    """A TestClient backed by a temporary, pre-seeded SQLite database."""
    db_path = tmp_path / "api.db"
    engine = create_engine(f"sqlite:///{db_path}", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    TestingSession = sessionmaker(bind=engine, autoflush=False, autocommit=False)

    _seed(TestingSession, tmp_path)

    def override_get_db():
        session = TestingSession()
        try:
            yield session
        finally:
            session.close()

    app.dependency_overrides[get_db] = override_get_db
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.clear()
        engine.dispose()


def _seed(session_factory, tmp_path: Path) -> None:
    export = tmp_path / "export"
    (export / "activities").mkdir(parents=True, exist_ok=True)
    (export / "activities" / "1.gpx").write_text(GPX, encoding="utf-8")
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
    with (export / "activities.csv").open("w", newline="", encoding="utf-8") as fh:
        writer = csv.writer(fh)
        writer.writerow(header)
        writer.writerow(row)

    profile_header = ["Athlete ID", "First Name", "Last Name", "City", "Country"]
    profile_row = ["42", "Test", "User", "Testville", "Testland"]
    with (export / "profile.csv").open("w", newline="", encoding="utf-8") as fh:
        writer = csv.writer(fh)
        writer.writerow(profile_header)
        writer.writerow(profile_row)

    session = session_factory()
    try:
        import_export(session, export)
    finally:
        session.close()


@pytest.mark.parametrize(
    "path",
    [
        "/health",
        "/api/meta",
        "/api/activities",
        "/api/dashboard",
        "/api/eddington",
        "/api/calendar/2024/4",
        "/api/heatmap/routes",
        "/api/milestones",
        "/api/rewind",
    ],
)
def test_endpoint_returns_200(client: TestClient, path: str):
    response = client.get(path)
    assert response.status_code == 200, response.text


def test_dashboard_has_all_widgets(client: TestClient):
    data = client.get("/api/dashboard").json()
    assert data["empty"] is False
    # Guard against signature/refactor regressions in the rolling-window widgets.
    for key in (
        "totals",
        "activity_calendar",
        "training_load",
        "weekday_stats",
        "daytime_stats",
        "distance_breakdown",
    ):
        assert key in data


def test_activity_detail_roundtrip(client: TestClient):
    listing = client.get("/api/activities").json()
    assert listing["total"] == 1
    activity_id = listing["items"][0]["activity_id"]
    detail = client.get(f"/api/activities/{activity_id}").json()
    assert detail["activity_id"] == activity_id
    assert "streams" in detail

    # The GPS track is surfaced as per-sample coordinates, index-aligned with the
    # numeric streams, and kept out of the numeric-only streams map.
    assert "latlng" not in detail["streams"]
    coords = detail["coordinates"]
    assert coords and coords[0] == [50.0, 4.0]
    assert len(coords) == len(detail["streams"]["distance"])


def test_delete_activities_removes_activity_and_streams(client: TestClient):
    activity_id = client.get("/api/activities").json()["items"][0]["activity_id"]
    # The seeded GPX activity has streams; confirm they exist before deletion.
    assert client.get(f"/api/activities/{activity_id}").json()["streams"]

    response = client.request("DELETE", "/api/activities", json={"activity_ids": [activity_id]})
    assert response.status_code == 200, response.text
    assert response.json() == {"deleted": 1}

    assert client.get("/api/activities").json()["total"] == 0
    assert client.get(f"/api/activities/{activity_id}").status_code == 404


def test_delete_activities_ignores_unknown_ids(client: TestClient):
    response = client.request(
        "DELETE", "/api/activities", json={"activity_ids": ["does-not-exist"]}
    )
    assert response.status_code == 200, response.text
    assert response.json() == {"deleted": 0}
    assert client.get("/api/activities").json()["total"] == 1


def test_fuzzy_search_by_date_and_sport(client: TestClient):
    # The seeded activity is a Run on 2024-04-01.
    assert client.get("/api/activities", params={"search": "2024-04 run"}).json()["total"] == 1
    assert client.get("/api/activities", params={"search": "2024 run"}).json()["total"] == 1
    # A non-matching month yields nothing.
    assert client.get("/api/activities", params={"search": "2024-05 run"}).json()["total"] == 0
    # A non-matching sport yields nothing.
    assert client.get("/api/activities", params={"search": "ride"}).json()["total"] == 0


def test_dashboard_filters(client: TestClient):
    data = client.get("/api/dashboard").json()
    assert data["available_years"] == [2024]

    # Filtering to a year without data marks the dashboard filtered-empty.
    empty = client.get("/api/dashboard", params={"start": "2023-01-01", "end": "2023-12-31"}).json()
    assert empty["filtered_empty"] is True
    assert empty["available_years"] == [2024]


def test_stale_athlete_falls_back_instead_of_404(client: TestClient):
    # A stale athlete id (e.g. cached in the browser after a db reset or a fresh
    # import of a different export) must not break the discovery/data endpoints:
    # it falls back to the real athlete so the UI can recover.
    meta = client.get("/api/meta", params={"athlete": "12345678"})
    assert meta.status_code == 200, meta.text
    body = meta.json()
    assert [a["athlete_id"] for a in body["athletes"]] == ["42"]
    assert body["athlete"]["athlete_id"] == "42"

    dashboard = client.get("/api/dashboard", params={"athlete": "12345678"})
    assert dashboard.status_code == 200, dashboard.text
    assert dashboard.json()["empty"] is False


def test_rewind_exposes_per_sport_and_achievements(client: TestClient):
    data = client.get("/api/rewind").json()["rewind"]

    # Per-sport breakdown carries both metrics so the UI can toggle distance/hours.
    assert data["per_sport"], "expected at least one sport"
    sport = data["per_sport"][0]
    assert {"sport_type", "label", "moving_time_s", "distance"} <= sport.keys()

    achievements = data["achievements"]
    assert "highlights" in achievements
    assert "personal_records" in achievements
    labels = {h["label"] for h in achievements["highlights"]}
    assert "Longest distance" in labels
    longest = next(h for h in achievements["highlights"] if h["label"] == "Longest distance")
    assert longest["activity_id"]
    assert longest["value"] > 0


def test_import_preview_suggests_name_match(client: TestClient, tmp_path: Path):
    # A second export for a *different* account but the SAME athlete name should
    # be previewed with a suggested merge into the seeded athlete (id 42).
    export = tmp_path / "second"
    (export / "activities").mkdir(parents=True, exist_ok=True)
    (export / "activities" / "9.gpx").write_text(GPX, encoding="utf-8")
    header = [
        "Activity ID",
        "Activity Date",
        "Activity Name",
        "Activity Type",
        "Elapsed Time",
        "Moving Time",
        "Distance",
        "Filename",
    ]
    row = [
        "9",
        "Apr 2, 2024, 6:00:00 AM",
        "Run",
        "Run",
        "600",
        "600",
        "2000",
        "activities/9.gpx",
    ]
    with (export / "activities.csv").open("w", newline="", encoding="utf-8") as fh:
        writer = csv.writer(fh)
        writer.writerow(header)
        writer.writerow(row)
    with (export / "profile.csv").open("w", newline="", encoding="utf-8") as fh:
        writer = csv.writer(fh)
        writer.writerow(["Athlete ID", "First Name", "Last Name"])
        writer.writerow(["777", "Test", "User"])

    resp = client.post("/api/import/preview", data={"source": str(export)})
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["provider"] == "strava"
    assert body["athlete_name"] == "Test User"
    assert body["source_athlete_id"] == "777"
    assert body["activity_count"] == 1
    assert body["is_existing_athlete"] is False
    # Matching name → suggested merge into the seeded athlete.
    assert body["suggested_athlete_id"] == "42"
    assert body["suggested_athlete_name"] == "Test User"

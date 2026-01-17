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

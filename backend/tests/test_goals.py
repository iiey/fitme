from __future__ import annotations

from datetime import datetime

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker

from app.db import Base, get_db
from app.main import app
from app.models import Activity, AthleteProfile, GoalSport

ATHLETE_ID = "u1"


def _activity(activity_id: str, sport_type: str, distance_m: float) -> Activity:
    return Activity(
        activity_id=activity_id,
        athlete_id=ATHLETE_ID,
        source="test",
        start_date_time=datetime(2024, 5, 1, 7, 0, 0),
        sport_type=sport_type,
        activity_type=sport_type,
        name=f"{sport_type} {activity_id}",
        distance_m=distance_m,
    )


@pytest.fixture
def client(tmp_path):
    """A TestClient over a temporary DB seeded with one athlete and three activities."""
    db_path = tmp_path / "goals.db"
    engine = create_engine(f"sqlite:///{db_path}", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    TestingSession = sessionmaker(bind=engine, autoflush=False, autocommit=False)

    session = TestingSession()
    session.add(AthleteProfile(athlete_id=ATHLETE_ID, first_name="Test"))
    session.add_all(
        [
            _activity("a1", "Run", distance_m=5000),
            _activity("a2", "Workout", distance_m=0),
            _activity("a3", "WeightTraining", distance_m=0),
        ]
    )
    session.commit()
    session.close()

    def override_get_db():
        db = TestingSession()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.clear()
        engine.dispose()


def _create_goal(client: TestClient, **overrides) -> dict:
    body = {
        "start_date": "2024-01-01",
        "end_date": "2024-12-31",
        "metric": "count",
        "target_value": 10,
        "sport_types": [],
    }
    body.update(overrides)
    resp = client.post("/api/goals", params={"athlete": ATHLETE_ID}, json=body)
    assert resp.status_code == 201, resp.text
    return resp.json()


def test_create_goal_with_multiple_sports_roundtrips(client: TestClient):
    goal = _create_goal(client, sport_types=["Workout", "WeightTraining"])
    # Stored sorted and deduplicated.
    assert goal["sport_types"] == ["WeightTraining", "Workout"]


def test_empty_sport_types_means_all_sports(client: TestClient):
    goal = _create_goal(client, sport_types=[])
    assert goal["sport_types"] == []


def test_progress_counts_only_selected_sports(client: TestClient):
    _create_goal(client, sport_types=["Workout", "WeightTraining"], metric="count")
    progress = client.get("/api/goals/progress", params={"athlete": ATHLETE_ID}).json()
    assert len(progress) == 1
    # Two of the three seeded activities match the selected sports.
    assert progress[0]["current_value"] == 2.0


def test_progress_all_sports_counts_everything(client: TestClient):
    _create_goal(client, sport_types=[], metric="count")
    progress = client.get("/api/goals/progress", params={"athlete": ATHLETE_ID}).json()
    assert progress[0]["current_value"] == 3.0


def test_progress_reports_achieved_date_when_met(client: TestClient):
    _create_goal(client, sport_types=[], metric="count", target_value=3)
    progress = client.get("/api/goals/progress", params={"athlete": ATHLETE_ID}).json()
    assert progress[0]["percentage"] == 100.0
    # The three seeded activities all fall on 2024-05-01, so the target is met then.
    assert progress[0]["achieved_on"] == "2024-05-01"


def test_progress_achieved_date_is_none_when_unmet(client: TestClient):
    _create_goal(client, sport_types=[], metric="count", target_value=10)
    progress = client.get("/api/goals/progress", params={"athlete": ATHLETE_ID}).json()
    assert progress[0]["percentage"] < 100.0
    assert progress[0]["achieved_on"] is None


def test_update_replaces_sports(client: TestClient):
    goal = _create_goal(client, sport_types=["Run"])
    resp = client.put(
        f"/api/goals/{goal['id']}",
        params={"athlete": ATHLETE_ID},
        json={"sport_types": ["Workout"]},
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["sport_types"] == ["Workout"]


def test_update_without_sport_types_keeps_them(client: TestClient):
    goal = _create_goal(client, sport_types=["Run", "Workout"])
    resp = client.put(
        f"/api/goals/{goal['id']}",
        params={"athlete": ATHLETE_ID},
        json={"target_value": 42},
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["sport_types"] == ["Run", "Workout"]
    assert resp.json()["target_value"] == 42


def test_delete_goal_removes_join_rows(client: TestClient):
    goal = _create_goal(client, sport_types=["Run", "Workout"])
    resp = client.delete(f"/api/goals/{goal['id']}", params={"athlete": ATHLETE_ID})
    assert resp.status_code == 204

    # The cascade must leave no orphaned goal_sport rows behind.
    db = next(app.dependency_overrides[get_db]())
    remaining = db.execute(select(GoalSport)).scalars().all()
    assert remaining == []

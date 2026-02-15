"""Tests for the optional AI-coach plugin.

The agent/service tests use Pydantic AI's TestModel, a fake model that runs
offline and deterministically (no Ollama, no API key, no tokens), so the whole
coach can be exercised in CI. Endpoint tests override the coach/core database
dependencies with temporary databases.
"""

from __future__ import annotations

import asyncio
from datetime import datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from pydantic_ai.models.test import TestModel
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.api.athletes import get_required_athlete_id
from app.athlete import get_athlete_config
from app.coach import service, store
from app.coach.agent import coach_agent
from app.coach.config import CONFIG_ID
from app.coach.db import CoachBase, get_coach_db
from app.coach.deps import CoachDeps, CoachView
from app.coach.models import CoachConfig
from app.coach.provider import InvalidCoachConfig, build_model
from app.coach.schemas import TrainingPlan
from app.db import Base, get_db
from app.main import app
from app.models import Activity, AthleteProfile

ATHLETE = "A1"


@pytest.fixture
def core_factory(tmp_path):
    """Core fitme database seeded with one athlete and three runs."""
    engine = create_engine(
        f"sqlite:///{tmp_path / 'core.db'}", connect_args={"check_same_thread": False}
    )
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    session = factory()
    try:
        session.add(
            AthleteProfile(
                athlete_id=ATHLETE,
                first_name="Test",
                max_heart_rate=190,
                resting_heart_rate=50,
                ftp=250,
            )
        )
        now = datetime.utcnow()
        for i in range(3):
            session.add(
                Activity(
                    activity_id=f"a{i}",
                    athlete_id=ATHLETE,
                    source="test",
                    start_date_time=now - timedelta(days=i * 2),
                    sport_type="Run",
                    activity_type="Run",
                    name=f"Run {i}",
                    distance_m=8000 + i * 1000,
                    moving_time_s=2400,
                    elevation_m=50,
                    average_heart_rate=150,
                    average_speed_ms=3.3,
                )
            )
        session.commit()
    finally:
        session.close()
    yield factory
    engine.dispose()


@pytest.fixture
def coach_factory(tmp_path):
    """Empty coach database with the coach schema created."""
    engine = create_engine(
        f"sqlite:///{tmp_path / 'coach.db'}", connect_args={"check_same_thread": False}
    )
    CoachBase.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    yield factory
    engine.dispose()


@pytest.fixture
def client(core_factory, coach_factory):
    def override_core():
        session = core_factory()
        try:
            yield session
        finally:
            session.close()

    def override_coach():
        session = coach_factory()
        try:
            yield session
        finally:
            session.close()

    app.dependency_overrides[get_db] = override_core
    app.dependency_overrides[get_coach_db] = override_coach
    app.dependency_overrides[get_required_athlete_id] = lambda: ATHLETE
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.clear()


# -- Provider factory -------------------------------------------------------


def test_build_model_branches():
    assert (
        type(
            build_model(CoachConfig(provider="ollama", model="m", base_url="http://h:11434"))
        ).__name__
        == "OpenAIChatModel"
    )
    assert (
        type(build_model(CoachConfig(provider="openai", model="m", api_key="k"))).__name__
        == "OpenAIChatModel"
    )
    assert (
        type(build_model(CoachConfig(provider="anthropic", model="m", api_key="k"))).__name__
        == "AnthropicModel"
    )
    with pytest.raises(InvalidCoachConfig):
        build_model(CoachConfig(provider="openai", model="m"))  # missing key
    with pytest.raises(InvalidCoachConfig):
        build_model(CoachConfig(provider="ollama", model="m"))  # missing base_url


# -- Data-access facade -----------------------------------------------------


def test_data_access_reads_core(core_factory):
    from app.coach import data_access

    session = core_factory()
    try:
        recent = data_access.recent_activities(session, ATHLETE, 10)
        assert len(recent) == 3
        assert recent[0]["distance_km"] == 8.0  # most recent first

        athlete = get_athlete_config(session, ATHLETE)
        profile = data_access.athlete_profile(athlete)
        assert profile["ftp_watts"] == 250

        assert data_access.period_totals(session, ATHLETE, "week", 8)
        assert "tsb" in data_access.training_load_summary(session, ATHLETE, athlete)
    finally:
        session.close()


# -- Store (sessions + memory) ----------------------------------------------


def test_store_sessions_messages_and_memory(coach_factory):
    db = coach_factory()
    try:
        session = store.create_session(db, ATHLETE, "First")
        store.add_message(db, session.id, "user", "hello")
        store.add_message(db, session.id, "assistant", "hi there")
        assert len(store.list_messages(db, session.id)) == 2

        renamed = store.rename_session(db, session.id, ATHLETE, "Renamed")
        assert renamed is not None and renamed.title == "Renamed"

        # Wrong athlete cannot see or delete the session.
        assert store.get_session(db, session.id, "other") is None

        assert store.delete_session(db, session.id, ATHLETE) is True
        assert store.list_messages(db, session.id) == []  # cascade

        store.add_memory(db, ATHLETE, "Training for a marathon")
        assert [m.content for m in store.list_memory(db, ATHLETE)] == ["Training for a marathon"]
        mem_id = store.list_memory(db, ATHLETE)[0].id
        assert store.delete_memory(db, mem_id, "other") is False  # athlete-scoped
        assert store.delete_memory(db, mem_id, ATHLETE) is True
        assert store.list_memory(db, ATHLETE) == []
    finally:
        db.close()


# -- Config / verify / status endpoints -------------------------------------


def test_config_crud_redaction_and_status(client, monkeypatch):
    async def fake_verify(config):
        return True, "Connection OK"

    monkeypatch.setattr("app.coach.router.verify_connection", fake_verify)

    # Not configured yet.
    assert client.get("/api/coach/status").json()["usable"] is False
    assert client.get("/api/coach/config").json() is None

    # Save an OpenAI config with a secret key.
    saved = client.put(
        "/api/coach/config",
        json={
            "provider": "openai",
            "model": "gpt-4o",
            "api_key": "supersecret",
            "enabled": True,
        },
    )
    assert saved.status_code == 200
    body = saved.json()
    assert body["has_api_key"] is True
    assert "supersecret" not in saved.text  # key is never echoed

    # Verified + enabled -> usable, so the launcher shows.
    assert client.get("/api/coach/status").json()["usable"] is True

    # Blank key on update keeps the stored key.
    kept = client.put(
        "/api/coach/config",
        json={
            "provider": "openai",
            "model": "gpt-4o-mini",
            "api_key": "",
            "enabled": True,
        },
    )
    assert kept.json()["has_api_key"] is True

    # Verify endpoint reports ok without persisting.
    assert client.post("/api/coach/config/verify", json={}).json()["ok"] is True


def test_verify_failure_blocks_save(client, monkeypatch):
    async def fake_verify(config):
        return False, "bad key"

    monkeypatch.setattr("app.coach.router.verify_connection", fake_verify)
    resp = client.put(
        "/api/coach/config",
        json={"provider": "openai", "model": "gpt-4o", "api_key": "k", "enabled": True},
    )
    assert resp.status_code == 400
    assert client.get("/api/coach/status").json()["usable"] is False


def test_disable_skips_verification(client, monkeypatch):
    calls = {"n": 0}

    async def ok_verify(config):
        calls["n"] += 1
        return True, "Connection OK"

    monkeypatch.setattr("app.coach.router.verify_connection", ok_verify)

    # Enabling verifies and makes the coach usable.
    client.put(
        "/api/coach/config",
        json={"provider": "openai", "model": "gpt-4o", "api_key": "k", "enabled": True},
    )
    assert calls["n"] == 1
    assert client.get("/api/coach/status").json()["usable"] is True

    # Disabling must take effect without re-verifying, even if a check would fail.
    async def fail_verify(config):
        calls["n"] += 1
        return False, "model offline"

    monkeypatch.setattr("app.coach.router.verify_connection", fail_verify)
    disabled = client.put(
        "/api/coach/config",
        json={"provider": "openai", "model": "gpt-4o", "api_key": "", "enabled": False},
    )
    assert disabled.status_code == 200
    assert disabled.json()["enabled"] is False
    assert calls["n"] == 1  # verify was not called for the disable
    assert client.get("/api/coach/status").json()["usable"] is False


# -- Session + memory endpoints ---------------------------------------------


def test_sessions_api(client):
    created = client.post("/api/coach/sessions").json()
    sid = created["id"]
    assert created["title"] == "New chat"
    assert any(s["id"] == sid for s in client.get("/api/coach/sessions").json())

    assert (
        client.patch(f"/api/coach/sessions/{sid}", json={"title": "Week review"}).json()["title"]
        == "Week review"
    )
    assert client.get(f"/api/coach/sessions/{sid}/messages").json() == []

    assert client.delete(f"/api/coach/sessions/{sid}").status_code == 204
    assert client.get(f"/api/coach/sessions/{sid}/messages").status_code == 404


def test_reset_all_wipes_config_and_data(client, monkeypatch):
    async def fake_verify(config):
        return True, "Connection OK"

    monkeypatch.setattr("app.coach.router.verify_connection", fake_verify)

    client.put(
        "/api/coach/config",
        json={
            "provider": "openai",
            "model": "gpt-4o",
            "api_key": "secret",
            "enabled": True,
        },
    )
    sid = client.post("/api/coach/sessions").json()["id"]
    assert client.get("/api/coach/config").json() is not None
    assert len(client.get("/api/coach/sessions").json()) == 1

    assert client.delete("/api/coach/data").status_code == 204

    assert client.get("/api/coach/config").json() is None
    assert client.get("/api/coach/sessions").json() == []
    assert client.get(f"/api/coach/sessions/{sid}/messages").status_code == 404


def test_memory_dedupe(coach_factory):
    db = coach_factory()
    try:
        store.add_memory(db, ATHLETE, "Runs on Tuesdays")
        store.add_memory(db, ATHLETE, "runs on tuesdays")  # case-insensitive duplicate
        assert len(store.list_memory(db, ATHLETE)) == 1
    finally:
        db.close()


def test_chat_rejects_empty_and_long_messages(client):
    assert client.post("/api/coach/chat", json={"message": "   "}).status_code == 422
    assert client.post("/api/coach/chat", json={"message": "x" * 5000}).status_code == 422


def test_memory_api(client, coach_factory):
    seed = coach_factory()
    store.add_memory(seed, ATHLETE, "Prefers morning runs")
    seed.close()

    listed = client.get("/api/coach/memory").json()
    assert [m["content"] for m in listed] == ["Prefers morning runs"]
    assert client.delete(f"/api/coach/memory/{listed[0]['id']}").status_code == 204
    assert client.get("/api/coach/memory").json() == []


# -- Agent / service with TestModel (offline) -------------------------------


def _seed_config(coach_db):
    coach_db.merge(
        CoachConfig(
            id=CONFIG_ID,
            provider="ollama",
            model="test",
            base_url="http://localhost:11434",
            enabled=True,
            last_status="ok",
        )
    )
    coach_db.commit()


def test_agent_runs_tools_and_remembers(core_factory, coach_factory):
    core_db = core_factory()
    coach_db = coach_factory()
    try:
        athlete = get_athlete_config(core_db, ATHLETE)
        deps = CoachDeps(
            core_db=core_db,
            coach_db=coach_db,
            athlete_id=ATHLETE,
            athlete=athlete,
            view=CoachView(),
        )
        result = coach_agent.run_sync("How is my training?", deps=deps, model=TestModel())
        assert isinstance(result.output, str)
        # TestModel calls every tool once, including remember, which writes a row.
        assert len(store.list_memory(coach_db, ATHLETE)) >= 1
    finally:
        core_db.close()
        coach_db.close()


def test_service_stream_persists_turns(core_factory, coach_factory):
    core_db = core_factory()
    coach_db = coach_factory()
    _seed_config(coach_db)
    session = store.create_session(coach_db, ATHLETE)
    athlete = get_athlete_config(core_db, ATHLETE)

    async def run():
        chunks: list[str] = []
        with coach_agent.override(model=TestModel()):
            async for delta in service.stream_chat(
                coach_db=coach_db,
                core_db=core_db,
                athlete_id=ATHLETE,
                athlete=athlete,
                session_id=session.id,
                message="hi",
                view=CoachView(),
            ):
                chunks.append(delta)
        return chunks

    try:
        asyncio.run(run())
        roles = [m.role for m in store.list_messages(coach_db, session.id)]
        assert "user" in roles and "assistant" in roles
    finally:
        core_db.close()
        coach_db.close()


def test_service_generate_plan(core_factory, coach_factory):
    core_db = core_factory()
    coach_db = coach_factory()
    _seed_config(coach_db)
    athlete = get_athlete_config(core_db, ATHLETE)

    async def run():
        with coach_agent.override(model=TestModel()):
            return await service.generate_plan(
                coach_db=coach_db,
                core_db=core_db,
                athlete_id=ATHLETE,
                athlete=athlete,
                goal="run a 5k",
                weeks=2,
                view=CoachView(),
            )

    try:
        output = asyncio.run(run())
        assert isinstance(output, (TrainingPlan, str))
        if isinstance(output, TrainingPlan):
            assert isinstance(output.weeks, list)
    finally:
        core_db.close()
        coach_db.close()

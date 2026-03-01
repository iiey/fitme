from __future__ import annotations

from datetime import date, timedelta
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.api.sync import maybe_start_daily_sync
from app.db import Base, get_db
from app.ingestion.intervals import IntervalsAthlete, IntervalsAuthError
from app.main import app
from app.models import AthleteProfile, SyncConfig
from app.timeutil import utcnow

ATHLETE_ID = "42"


@pytest.fixture
def session_factory(tmp_path: Path):
    db_path = tmp_path / "sync_api.db"
    engine = create_engine(f"sqlite:///{db_path}", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    session = factory()
    try:
        session.add(AthleteProfile(athlete_id=ATHLETE_ID, first_name="Test", last_name="User"))
        session.commit()
    finally:
        session.close()
    yield factory
    engine.dispose()


@pytest.fixture
def client(session_factory):
    def override_get_db():
        session = session_factory()
        try:
            yield session
        finally:
            session.close()

    app.dependency_overrides[get_db] = override_get_db
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.clear()


class _OkClient:
    """A fake IntervalsClient whose credentials always validate."""

    def __init__(self, *args, **kwargs) -> None:
        pass

    def __enter__(self):
        return self

    def __exit__(self, *exc) -> None:
        pass

    def test_connection(self) -> IntervalsAthlete:
        return IntervalsAthlete(id="0", name="Test User")


class _AuthFailClient(_OkClient):
    def test_connection(self):
        raise IntervalsAuthError("bad key")


def _patch_client(monkeypatch, cls) -> None:
    monkeypatch.setattr("app.api.sync.IntervalsClient", cls)


class _InlineThread:
    """Runs the worker synchronously so the background sync is observable here."""

    def __init__(self, target, args=(), kwargs=None, daemon=False):
        self._target = target
        self._args = args
        self._kwargs = kwargs or {}

    def start(self):
        self._target(*self._args, **self._kwargs)


def _configure_sync(
    session_factory, *, enabled=True, api_key="secret", last_auto_sync_on=None
) -> None:
    session = session_factory()
    try:
        session.add(
            SyncConfig(
                provider="intervals",
                athlete_id=ATHLETE_ID,
                icu_athlete_id="0",
                api_key=api_key,
                enabled=enabled,
                last_auto_sync_on=last_auto_sync_on,
            )
        )
        session.commit()
    finally:
        session.close()


def _patch_background(monkeypatch, session_factory, calls: list) -> None:
    """Make the background sync run inline against the test DB and record runs."""

    def fake_sync(db, config, *, full_resync=False, since=None, until=None):
        calls.append(full_resync)
        config.last_status = "ok"
        db.add(config)
        db.commit()

    monkeypatch.setattr("app.api.sync.sync", fake_sync)
    monkeypatch.setattr("app.api.sync.SessionLocal", session_factory)
    monkeypatch.setattr("app.api.sync.threading.Thread", _InlineThread)


def _assert_lock_free() -> None:
    from app.concurrency import import_lock

    assert import_lock.acquire(blocking=False)
    import_lock.release()


def test_get_config_is_null_when_unconfigured(client: TestClient):
    response = client.get("/api/sync/config")
    assert response.status_code == 200
    assert response.json() is None


def test_status_unconfigured(client: TestClient):
    response = client.get("/api/sync/status")
    assert response.status_code == 200
    assert response.json() == {
        "configured": False,
        "enabled": False,
        "running": False,
        "synced_through": None,
        "last_run_at": None,
        "last_status": None,
        "last_message": None,
    }


def test_put_config_validates_and_redacts_key(client: TestClient, monkeypatch):
    _patch_client(monkeypatch, _OkClient)
    response = client.put(
        "/api/sync/config",
        json={"athlete_id": ATHLETE_ID, "api_key": "secret-key", "icu_athlete_id": "0"},
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["athlete_id"] == ATHLETE_ID
    assert body["has_api_key"] is True
    assert body["athlete_name"] == "Test User"
    # The key itself is never returned.
    assert "api_key" not in body
    assert "secret-key" not in response.text


def test_put_config_rejects_bad_credentials(client: TestClient, monkeypatch):
    _patch_client(monkeypatch, _AuthFailClient)
    response = client.put(
        "/api/sync/config",
        json={"athlete_id": ATHLETE_ID, "api_key": "wrong"},
    )
    assert response.status_code == 401


def test_put_config_unknown_athlete(client: TestClient, monkeypatch):
    _patch_client(monkeypatch, _OkClient)
    response = client.put(
        "/api/sync/config",
        json={"athlete_id": "does-not-exist", "api_key": "secret"},
    )
    assert response.status_code == 404


def test_put_config_blank_key_keeps_stored(client: TestClient, monkeypatch):
    _patch_client(monkeypatch, _OkClient)
    client.put(
        "/api/sync/config",
        json={"athlete_id": ATHLETE_ID, "api_key": "secret-key"},
    )
    # Re-save with a blank key (e.g. toggling enabled) keeps the stored key.
    response = client.put(
        "/api/sync/config",
        json={"athlete_id": ATHLETE_ID, "api_key": "", "enabled": False},
    )
    assert response.status_code == 200, response.text
    assert response.json()["has_api_key"] is True
    assert response.json()["enabled"] is False


def test_put_config_blank_key_without_existing_is_422(client: TestClient, monkeypatch):
    _patch_client(monkeypatch, _OkClient)
    response = client.put(
        "/api/sync/config",
        json={"athlete_id": ATHLETE_ID, "api_key": "   "},
    )
    assert response.status_code == 422


def test_delete_config(client: TestClient, monkeypatch):
    _patch_client(monkeypatch, _OkClient)
    client.put("/api/sync/config", json={"athlete_id": ATHLETE_ID, "api_key": "secret"})
    assert client.get("/api/sync/config").json() is not None

    response = client.delete("/api/sync/config")
    assert response.status_code == 204
    assert client.get("/api/sync/config").json() is None


def test_trigger_without_config_is_404(client: TestClient):
    response = client.post("/api/sync/trigger", json={})
    assert response.status_code == 404


def test_trigger_disabled_is_409(client: TestClient, session_factory, monkeypatch):
    session = session_factory()
    try:
        session.add(
            SyncConfig(
                provider="intervals",
                athlete_id=ATHLETE_ID,
                icu_athlete_id="0",
                api_key="secret",
                enabled=False,
            )
        )
        session.commit()
    finally:
        session.close()

    response = client.post("/api/sync/trigger", json={})
    assert response.status_code == 409


def test_trigger_runs_sync_in_background(client: TestClient, session_factory, monkeypatch):
    # Configure sync.
    _patch_client(monkeypatch, _OkClient)
    client.put("/api/sync/config", json={"athlete_id": ATHLETE_ID, "api_key": "secret"})

    calls: dict = {}

    def fake_sync(db, config, *, full_resync=False, since=None, until=None):
        calls["full_resync"] = full_resync
        calls["since"] = since
        calls["until"] = until
        config.last_status = "ok"
        db.add(config)
        db.commit()

    # Run the "background" job inline and against the test database.
    monkeypatch.setattr("app.api.sync.sync", fake_sync)
    monkeypatch.setattr("app.api.sync.SessionLocal", session_factory)
    monkeypatch.setattr("app.api.sync.threading.Thread", _InlineThread)

    response = client.post("/api/sync/trigger", json={"full_resync": True})
    assert response.status_code == 200, response.text
    assert response.json()["status"] == "ok"
    assert calls == {"full_resync": True, "since": None, "until": None}

    # The lock must have been released by the job.
    _assert_lock_free()


def test_trigger_passes_resync_window(client: TestClient, session_factory, monkeypatch):
    """A posted oldest/newest window is forwarded and implies a full resync."""
    _patch_client(monkeypatch, _OkClient)
    client.put("/api/sync/config", json={"athlete_id": ATHLETE_ID, "api_key": "secret"})

    calls: dict = {}

    def fake_sync(db, config, *, full_resync=False, since=None, until=None):
        calls["full_resync"] = full_resync
        calls["since"] = since
        calls["until"] = until
        config.last_status = "ok"
        db.add(config)
        db.commit()

    monkeypatch.setattr("app.api.sync.sync", fake_sync)
    monkeypatch.setattr("app.api.sync.SessionLocal", session_factory)
    monkeypatch.setattr("app.api.sync.threading.Thread", _InlineThread)

    response = client.post(
        "/api/sync/trigger",
        json={"oldest": "2015-01-01", "newest": "2016-12-31"},
    )
    assert response.status_code == 200, response.text
    # Window forwarded as dates, and a bounded window forces a full resync.
    assert calls == {
        "full_resync": True,
        "since": date(2015, 1, 1),
        "until": date(2016, 12, 31),
    }
    _assert_lock_free()


def test_trigger_rejects_inverted_window(client: TestClient, session_factory, monkeypatch):
    """oldest after newest is a validation error, not a started run."""
    _patch_client(monkeypatch, _OkClient)
    client.put("/api/sync/config", json={"athlete_id": ATHLETE_ID, "api_key": "secret"})

    response = client.post(
        "/api/sync/trigger",
        json={"oldest": "2020-01-01", "newest": "2015-01-01"},
    )
    assert response.status_code == 422
    _assert_lock_free()


# -- Daily startup sync -----------------------------------------------------


def test_startup_sync_skipped_when_unconfigured(session_factory, monkeypatch):
    calls: list = []
    _patch_background(monkeypatch, session_factory, calls)

    maybe_start_daily_sync()

    assert calls == []  # nothing configured -> nothing ran
    _assert_lock_free()


def test_startup_sync_skipped_when_disabled(session_factory, monkeypatch):
    _configure_sync(session_factory, enabled=False)
    calls: list = []
    _patch_background(monkeypatch, session_factory, calls)

    maybe_start_daily_sync()

    assert calls == []
    _assert_lock_free()


def test_startup_sync_runs_once_then_skips_same_day(session_factory, monkeypatch):
    _configure_sync(session_factory)
    calls: list = []
    _patch_background(monkeypatch, session_factory, calls)

    maybe_start_daily_sync()
    assert calls == [False]  # a normal (not full) sync ran

    # The day's run is recorded, so a restart the same day does not re-run it.
    session = session_factory()
    try:
        config = session.get(SyncConfig, "intervals")
        assert config.last_auto_sync_on == utcnow().date()
    finally:
        session.close()

    maybe_start_daily_sync()
    assert calls == [False]  # unchanged: skipped
    _assert_lock_free()


def test_startup_sync_runs_again_on_a_new_day(session_factory, monkeypatch):
    yesterday = utcnow().date() - timedelta(days=1)
    _configure_sync(session_factory, last_auto_sync_on=yesterday)
    calls: list = []
    _patch_background(monkeypatch, session_factory, calls)

    maybe_start_daily_sync()

    assert calls == [False]
    _assert_lock_free()


def test_startup_sync_skipped_when_lock_is_held(session_factory, monkeypatch):
    _configure_sync(session_factory)
    calls: list = []
    _patch_background(monkeypatch, session_factory, calls)

    from app.concurrency import import_lock

    assert import_lock.acquire(blocking=False)
    try:
        maybe_start_daily_sync()
        assert calls == []  # an import/sync already running -> skipped
    finally:
        import_lock.release()


def test_startup_sync_never_raises_and_frees_lock_on_failure(session_factory, monkeypatch):
    _configure_sync(session_factory)
    monkeypatch.setattr("app.api.sync.SessionLocal", session_factory)

    class _BoomThread:
        def __init__(self, *args, **kwargs):
            pass

        def start(self):
            raise RuntimeError("cannot start worker thread")

    monkeypatch.setattr("app.api.sync.threading.Thread", _BoomThread)

    # Must not propagate: a startup convenience never blocks app start-up.
    maybe_start_daily_sync()

    # And the ingestion lock must not be leaked when the worker fails to start.
    _assert_lock_free()

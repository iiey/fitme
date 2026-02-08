from __future__ import annotations

import os

from sqlalchemy import create_engine, event
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from app.config import settings

# The coach owns a separate SQLite database so the whole feature can be added or
# removed without touching the core schema or its migrations. Override with
# FITME_COACH_DATABASE_URL; defaults to coach.db next to the core database.
COACH_DATABASE_URL = os.environ.get(
    "FITME_COACH_DATABASE_URL",
    f"sqlite:///{settings.storage_dir / 'coach.db'}",
)

_is_sqlite = COACH_DATABASE_URL.startswith("sqlite")
_connect_args = {"check_same_thread": False} if _is_sqlite else {}

engine = create_engine(COACH_DATABASE_URL, connect_args=_connect_args, future=True)

if _is_sqlite:

    @event.listens_for(engine, "connect")
    def _set_sqlite_pragma(dbapi_connection, connection_record):
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.execute("PRAGMA synchronous=NORMAL")
        # Enforce ON DELETE CASCADE (session -> messages); off by default in SQLite.
        cursor.execute("PRAGMA foreign_keys=ON")
        # Wait briefly instead of failing immediately if another write holds the lock.
        cursor.execute("PRAGMA busy_timeout=5000")
        cursor.close()


SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)


class CoachBase(DeclarativeBase):
    """Declarative base for coach-owned models (separate from the core Base)."""


def get_coach_db():
    """FastAPI dependency that yields a coach-database session."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def create_tables() -> None:
    """Create the coach tables in coach.db if they do not yet exist."""
    # Import models so they register on CoachBase.metadata.
    from app.coach import models  # noqa: F401

    CoachBase.metadata.create_all(bind=engine)

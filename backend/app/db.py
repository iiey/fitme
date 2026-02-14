from __future__ import annotations

from sqlalchemy import create_engine, event
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from app.config import settings

_is_sqlite = settings.database_url.startswith("sqlite")

# SQLite needs ``check_same_thread=False`` for use across FastAPI's threadpool.
_connect_args = {"check_same_thread": False} if _is_sqlite else {}

# How long a reader waits for the single writer (e.g. a background import) before
# giving up with "database is locked". SQLite's default is 0 (fail immediately).
_SQLITE_BUSY_TIMEOUT_MS = 5000

engine = create_engine(
    settings.database_url,
    connect_args=_connect_args,
    future=True,
)

if _is_sqlite:

    @event.listens_for(engine, "connect")
    def _set_sqlite_pragma(dbapi_connection, connection_record):
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.execute("PRAGMA synchronous=NORMAL")
        cursor.execute(f"PRAGMA busy_timeout={_SQLITE_BUSY_TIMEOUT_MS}")
        # SQLite ignores foreign keys unless asked, per connection. Without this
        # the goal_sport -> goal ON DELETE CASCADE is silently inert, leaving
        # orphan goal_sport rows when a goal (or its athlete) is bulk-deleted.
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()


SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)


class Base(DeclarativeBase):
    """Declarative base for all ORM models."""


def get_db():
    """FastAPI dependency that yields a scoped database session."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db() -> None:
    """Create all tables if they do not yet exist (dev convenience)."""
    # Import models so they are registered on ``Base.metadata``.
    from app import models  # noqa: F401

    Base.metadata.create_all(bind=engine)

from __future__ import annotations

import os
import sys
from pathlib import Path

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

# Ensure the backend package root is importable.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

# Use an isolated in-memory database for the test session.
os.environ.setdefault("FITME_DATABASE_URL", "sqlite:///:memory:")


@pytest.fixture
def db_session():
    from app.db import Base

    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    TestingSession = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    session = TestingSession()
    try:
        yield session
    finally:
        session.close()
        engine.dispose()

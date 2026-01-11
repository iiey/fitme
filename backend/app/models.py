from __future__ import annotations

from datetime import datetime

from sqlalchemy import Boolean, DateTime, Float, Index, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base
from app.types import CompressedJSON


class Activity(Base):
    """A single recorded activity (the hub entity)."""

    __tablename__ = "activity"

    activity_id: Mapped[str] = mapped_column(String, primary_key=True)

    start_date_time: Mapped[datetime] = mapped_column(DateTime, index=True)
    sport_type: Mapped[str] = mapped_column(String, index=True)
    activity_type: Mapped[str] = mapped_column(String, index=True)

    name: Mapped[str] = mapped_column(String, default="")
    description: Mapped[str | None] = mapped_column(String, nullable=True)

    # Stored in SI base units: metres, metres/second, seconds.
    distance_m: Mapped[float] = mapped_column(Float, default=0.0)
    elevation_m: Mapped[float] = mapped_column(Float, default=0.0)
    moving_time_s: Mapped[int] = mapped_column(Integer, default=0)
    elapsed_time_s: Mapped[int] = mapped_column(Integer, default=0)

    average_speed_ms: Mapped[float | None] = mapped_column(Float, nullable=True)
    max_speed_ms: Mapped[float | None] = mapped_column(Float, nullable=True)

    average_heart_rate: Mapped[int | None] = mapped_column(Integer, nullable=True)
    max_heart_rate: Mapped[int | None] = mapped_column(Integer, nullable=True)
    average_cadence: Mapped[int | None] = mapped_column(Integer, nullable=True)
    max_cadence: Mapped[int | None] = mapped_column(Integer, nullable=True)
    average_power: Mapped[int | None] = mapped_column(Integer, nullable=True)
    max_power: Mapped[int | None] = mapped_column(Integer, nullable=True)
    normalized_power: Mapped[float | None] = mapped_column(Float, nullable=True)

    calories: Mapped[int | None] = mapped_column(Integer, nullable=True)

    start_latitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    start_longitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    polyline: Mapped[str | None] = mapped_column(String, nullable=True)
    country_code: Mapped[str | None] = mapped_column(String(2), nullable=True)

    device_name: Mapped[str | None] = mapped_column(String, nullable=True)
    gear_id: Mapped[str | None] = mapped_column(String, index=True, nullable=True)
    gear_name: Mapped[str | None] = mapped_column(String, nullable=True)

    is_commute: Mapped[bool] = mapped_column(Boolean, default=False)
    workout_type: Mapped[str | None] = mapped_column(String, nullable=True)
    import_source: Mapped[str] = mapped_column(String, default="csv")

    streams_are_imported: Mapped[bool] = mapped_column(Boolean, default=False, index=True)

    # Fingerprint of the source row/file used for idempotent re-imports.
    source_hash: Mapped[str | None] = mapped_column(String, nullable=True)

    created_on: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_on: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow
    )

    __table_args__ = (
        Index("ix_activity_type_start", "activity_type", "start_date_time"),
        Index("ix_activity_sport_start", "sport_type", "start_date_time"),
    )


class ActivityStream(Base):
    """Time-series data for an activity (one row per stream type)."""

    __tablename__ = "activity_stream"

    activity_id: Mapped[str] = mapped_column(String, primary_key=True, index=True)
    stream_type: Mapped[str] = mapped_column(String, primary_key=True)
    data: Mapped[list] = mapped_column(CompressedJSON, default=list)
    created_on: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class BestEffort(Base):
    """Best (fastest) time achieved over a standard distance within an activity."""

    __tablename__ = "best_effort"

    activity_id: Mapped[str] = mapped_column(String, primary_key=True, index=True)
    distance_m: Mapped[int] = mapped_column(Integer, primary_key=True)
    sport_type: Mapped[str] = mapped_column(String, index=True)
    activity_type: Mapped[str] = mapped_column(String, index=True)
    start_date_time: Mapped[datetime] = mapped_column(DateTime, index=True)
    time_s: Mapped[float] = mapped_column(Float)

    __table_args__ = (Index("ix_best_effort_lookup", "activity_type", "distance_m", "time_s"),)


class Gear(Base):
    """A bike or pair of shoes."""

    __tablename__ = "gear"

    gear_id: Mapped[str] = mapped_column(String, primary_key=True)
    name: Mapped[str] = mapped_column(String, default="")
    gear_type: Mapped[str] = mapped_column(String, default="bike")  # bike | shoe
    distance_m: Mapped[float] = mapped_column(Float, default=0.0)
    is_retired: Mapped[bool] = mapped_column(Boolean, default=False)
    created_on: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class ImportRun(Base):
    """Audit record of a single import run (for the periodic-import summary)."""

    __tablename__ = "import_run"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    started_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    source: Mapped[str] = mapped_column(String, default="")
    activities_added: Mapped[int] = mapped_column(Integer, default=0)
    activities_updated: Mapped[int] = mapped_column(Integer, default=0)
    activities_skipped: Mapped[int] = mapped_column(Integer, default=0)
    gear_upserted: Mapped[int] = mapped_column(Integer, default=0)
    status: Mapped[str] = mapped_column(String, default="running")
    message: Mapped[str | None] = mapped_column(String, nullable=True)


class AthleteProfile(Base):
    """The athlete's identity, parsed from the export's ``profile.csv``.

    Single row, keyed by a fixed id, so re-imports overwrite it in place.
    """

    __tablename__ = "athlete_profile"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, default=1)
    athlete_id: Mapped[str | None] = mapped_column(String, nullable=True)
    first_name: Mapped[str | None] = mapped_column(String, nullable=True)
    last_name: Mapped[str | None] = mapped_column(String, nullable=True)
    city: Mapped[str | None] = mapped_column(String, nullable=True)
    state: Mapped[str | None] = mapped_column(String, nullable=True)
    country: Mapped[str | None] = mapped_column(String, nullable=True)
    sex: Mapped[str | None] = mapped_column(String, nullable=True)
    updated_on: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow
    )

from __future__ import annotations

from datetime import date, datetime

from sqlalchemy import (
    JSON,
    Boolean,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base
from app.types import CompressedJSON


class Activity(Base):
    """A single recorded activity (the hub entity)."""

    __tablename__ = "activity"

    activity_id: Mapped[str] = mapped_column(String, primary_key=True)
    athlete_id: Mapped[str] = mapped_column(String, nullable=False, index=True)

    # Provenance. ``source`` is the provider the activity came from (e.g.
    # ``strava``, ``garmin``); ``external_id`` is that provider's native id.
    # For Strava the primary key ``activity_id`` stays equal to ``external_id``
    # for backward compatibility; other providers are namespaced (see importer).
    source: Mapped[str] = mapped_column(String, nullable=False, default="strava")
    external_id: Mapped[str | None] = mapped_column(String, nullable=True)
    # Content fingerprint identifying the same physical activity across
    # providers, derived from immutable properties (see app.domain.dedup).
    dedup_key: Mapped[str | None] = mapped_column(String, nullable=True)

    start_date_time: Mapped[datetime] = mapped_column(DateTime, index=True)
    # Stable UTC start used for cross-source de-duplication. ``start_date_time``
    # is the athlete's *local* wall-clock (for weekday/time-of-day display),
    # which differs by timezone between providers; ``start_utc`` is the same
    # instant in UTC, so the same workout fingerprints identically regardless of
    # which provider (or file type) it came from.
    start_utc: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    sport_type: Mapped[str] = mapped_column(String, index=True)
    activity_type: Mapped[str] = mapped_column(String, index=True)

    name: Mapped[str] = mapped_column(String, default="")
    description: Mapped[str | None] = mapped_column(String, nullable=True)
    user_note: Mapped[str | None] = mapped_column(String, nullable=True)

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
        Index("ix_activity_athlete_start", "athlete_id", "start_date_time"),
        # Fast cross-source duplicate lookup by content fingerprint.
        Index("ix_activity_athlete_dedup", "athlete_id", "dedup_key"),
        # A provider's native id is unique per athlete and per provider.
        Index(
            "uq_activity_source_external",
            "athlete_id",
            "source",
            "external_id",
            unique=True,
        ),
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
    athlete_id: Mapped[str] = mapped_column(String, nullable=False, index=True)
    name: Mapped[str] = mapped_column(String, default="")
    gear_type: Mapped[str] = mapped_column(String, default="bike")  # bike | shoe
    distance_m: Mapped[float] = mapped_column(Float, default=0.0)
    is_retired: Mapped[bool] = mapped_column(Boolean, default=False)
    created_on: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class ImportRun(Base):
    """Audit record of a single import run (for the periodic-import summary)."""

    __tablename__ = "import_run"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    athlete_id: Mapped[str | None] = mapped_column(String, nullable=True)
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
    """An athlete's identity, parsed from the export's ``profile.csv``."""

    __tablename__ = "athlete_profile"

    athlete_id: Mapped[str] = mapped_column(String, primary_key=True)
    first_name: Mapped[str | None] = mapped_column(String, nullable=True)
    last_name: Mapped[str | None] = mapped_column(String, nullable=True)
    city: Mapped[str | None] = mapped_column(String, nullable=True)
    state: Mapped[str | None] = mapped_column(String, nullable=True)
    country: Mapped[str | None] = mapped_column(String, nullable=True)
    sex: Mapped[str | None] = mapped_column(String, nullable=True)

    # Training parameters (editable via Settings UI).
    birthday: Mapped[date | None] = mapped_column(Date, nullable=True)
    weight_kg: Mapped[float | None] = mapped_column(Float, nullable=True)
    ftp: Mapped[int | None] = mapped_column(Integer, nullable=True)
    max_heart_rate: Mapped[int | None] = mapped_column(Integer, nullable=True)
    resting_heart_rate: Mapped[int | None] = mapped_column(Integer, nullable=True)
    unit_system: Mapped[str | None] = mapped_column(String, nullable=True)
    threshold_pace: Mapped[int | None] = mapped_column(Integer, nullable=True)
    heart_rate_zones: Mapped[list | None] = mapped_column(JSON, nullable=True)
    power_zones: Mapped[list | None] = mapped_column(JSON, nullable=True)
    pace_zones: Mapped[list | None] = mapped_column(JSON, nullable=True)

    updated_on: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow
    )


class SourceIdentity(Base):
    """Maps a provider's athlete id to our canonical ``athlete_id``.

    Strava and Garmin assign independent account ids to the same person, so
    there is no automatic way to know two exports belong together. When the user
    chooses to merge an import into an existing athlete, that decision is
    recorded here keyed on ``(source, source_athlete_id)`` so every later import
    of the same provider account resolves to the same canonical athlete without
    asking again.
    """

    __tablename__ = "source_identity"

    # The provider (``strava`` | ``garmin`` | ...).
    source: Mapped[str] = mapped_column(String, primary_key=True)
    # The provider's own athlete id (Strava athlete id / Garmin userProfileId).
    source_athlete_id: Mapped[str] = mapped_column(String, primary_key=True)
    # The canonical athlete these activities are stored under.
    athlete_id: Mapped[str] = mapped_column(String, nullable=False, index=True)
    created_on: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_on: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow
    )


class Goal(Base):
    """A training goal over a flexible date range."""

    __tablename__ = "goal"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    athlete_id: Mapped[str] = mapped_column(String, nullable=False, index=True)
    start_date: Mapped[date] = mapped_column(Date, nullable=False)
    end_date: Mapped[date] = mapped_column(Date, nullable=False)
    metric: Mapped[str] = mapped_column(String, nullable=False)
    target_value: Mapped[float] = mapped_column(Float, nullable=False)
    note: Mapped[str | None] = mapped_column(String, nullable=True)
    created_on: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_on: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow
    )

    # Sports this goal counts toward. An empty collection means "all sports".
    # Loaded eagerly so ``sport_types`` is always available without an extra
    # round-trip when serializing a goal.
    sports: Mapped[list[GoalSport]] = relationship(
        back_populates="goal",
        cascade="all, delete-orphan",
        lazy="selectin",
    )

    __table_args__ = (Index("ix_goal_athlete_dates", "athlete_id", "start_date", "end_date"),)

    @property
    def sport_types(self) -> list[str]:
        """The goal's sports as a sorted list of sport-type strings."""
        return sorted(link.sport_type for link in self.sports)


class GoalSport(Base):
    """A sport a goal counts toward (join row between ``goal`` and a sport type).

    Modeling sports as their own rows (rather than a single column) lets one
    goal target several sports at once, e.g. "Workout + Weight Training".
    """

    __tablename__ = "goal_sport"

    goal_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("goal.id", ondelete="CASCADE"),
        primary_key=True,
    )
    sport_type: Mapped[str] = mapped_column(String, primary_key=True)

    goal: Mapped[Goal] = relationship(back_populates="sports")


class SyncConfig(Base):
    """Configuration and run-state for a continuous provider sync (Intervals.icu).

    A single row per provider drives the periodic pull of new activities. It
    binds the sync to a canonical ``athlete_id`` (so synced activities land under
    the same athlete as existing bulk imports and de-duplicate against them) and
    persists how far the sync has progressed across restarts.
    """

    __tablename__ = "sync_config"

    # The sync provider; one configuration row per provider (``intervals`` today).
    provider: Mapped[str] = mapped_column(String, primary_key=True, default="intervals")
    # Canonical athlete the synced activities belong to. Must match the athlete
    # used for existing bulk imports, or dedup cannot collapse the same workout.
    athlete_id: Mapped[str] = mapped_column(String, nullable=False, index=True)
    # The provider's immutable athlete id ("0" resolves to the API key's athlete).
    icu_athlete_id: Mapped[str] = mapped_column(String, default="0")
    # Personal API key (HTTP Basic password). Write-only in API responses.
    api_key: Mapped[str] = mapped_column(String, nullable=False)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    # Watermark: local start time of the newest activity synced so far.
    synced_through: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    # Observability for the most recent run (``ok`` | ``error`` | ``running``).
    last_run_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    last_status: Mapped[str | None] = mapped_column(String, nullable=True)
    last_message: Mapped[str | None] = mapped_column(String, nullable=True)
    # Calendar date (UTC) of the most recent sync started automatically on app
    # startup. Gates the once-per-day startup sync so repeated restarts on the
    # same day do not start it again. Independent of manual triggers.
    last_auto_sync_on: Mapped[date | None] = mapped_column(Date, nullable=True)
    created_on: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_on: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow
    )

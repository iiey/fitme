from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel


class ActivitySummary(BaseModel):
    activity_id: str
    name: str
    start_date_time: datetime
    sport_type: str
    sport_label: str
    activity_type: str
    distance_km: float
    distance_mi: float
    elevation_m: float
    moving_time_s: int
    elapsed_time_s: int
    average_speed_kmh: float | None
    average_pace_s_per_km: float | None
    pace_unit: str
    average_heart_rate: int | None
    max_heart_rate: int | None
    average_power: int | None
    calories: int | None
    is_commute: bool
    gear_name: str | None
    has_map: bool


class HrZoneItem(BaseModel):
    zone: int
    label: str
    lower_bpm: int
    upper_bpm: int | None
    seconds: int
    percentage: float


class PaceZoneItem(BaseModel):
    zone: int
    label: str
    slow_pace: float | None
    fast_pace: float | None
    seconds: int
    percentage: float


class ActivityDetail(ActivitySummary):
    description: str | None
    max_speed_kmh: float | None
    average_cadence: int | None
    max_cadence: int | None
    max_power: int | None
    normalized_power: float | None
    device_name: str | None
    polyline: str | None
    start_latitude: float | None
    start_longitude: float | None
    streams: dict[str, list]
    best_efforts: list[BestEffortItem]
    hr_zones: list[HrZoneItem] | None = None
    pace_zones: list[PaceZoneItem] | None = None


class BestEffortItem(BaseModel):
    distance_m: int
    label: str
    time_s: float


class PaginatedActivities(BaseModel):
    total: int
    limit: int
    offset: int
    items: list[ActivitySummary]


class GearItem(BaseModel):
    gear_id: str
    name: str
    gear_type: str
    distance_km: float
    is_retired: bool


class ImportRequest(BaseModel):
    source: str
    # ``None`` lets the importer auto-detect the provider from the archive
    # contents (Strava ``activities.csv`` vs Garmin ``DI_CONNECT`` export).
    provider: str | None = None
    force: bool = False
    # When set, merge the import into this existing athlete instead of the
    # provider's own account (``None`` keeps the export's own athlete).
    athlete_id: str | None = None


class ImportPreview(BaseModel):
    """Inspection of an export before importing, used to choose the athlete.

    Lets the dialog show what was detected and offer "import as a new athlete"
    vs "merge into an existing athlete", with a suggested target when the
    provider account was merged before or the name matches an existing athlete.
    """

    # Server-side token to pass back to the import call (stored upload path or
    # the provided server path).
    source: str
    provider: str  # strava | garmin
    athlete_name: str | None = None
    # The provider's own athlete id (Strava athlete id / Garmin userProfileId).
    source_athlete_id: str | None = None
    activity_count: int = 0
    # Whether the provider's own athlete already exists locally (a re-import).
    is_existing_athlete: bool = False
    # Pre-selected merge target (a *different* existing athlete) when one is
    # confidently suggested, else ``None`` (default to a new athlete).
    suggested_athlete_id: str | None = None
    suggested_athlete_name: str | None = None


class ImportRunStatus(BaseModel):
    """Live status of a background import, polled by the client."""

    id: int
    status: str  # running | ok | error
    source: str | None = None
    added: int = 0
    updated: int = 0
    skipped: int = 0
    deduped: int = 0
    gear_upserted: int = 0
    files_parsed: int = 0
    parse_errors: int = 0
    # ``total`` is the number of activities to process (known once the export is
    # read); ``processed`` counts those handled so far. Both drive the progress
    # bar. ``message`` carries an error description when ``status == "error"``.
    total: int | None = None
    processed: int = 0
    finished_at: datetime | None = None
    message: str | None = None


class AthleteListItem(BaseModel):
    athlete_id: str
    name: str | None
    location: str | None
    activity_count: int
    profile_url: str | None


class MetaResponse(BaseModel):
    app_name: str
    app_subtitle: str
    unit_system: str
    distance_unit: str
    elevation_unit: str
    sport_types: list[SportTypeOption]
    activity_count: int
    first_activity: datetime | None
    last_activity: datetime | None
    athlete: AthleteInfo | None = None
    athletes: list[AthleteListItem] = []


class AthleteInfo(BaseModel):
    athlete_id: str | None
    name: str | None
    location: str | None
    profile_url: str | None


class SportTypeOption(BaseModel):
    value: str
    label: str
    activity_type: str


class SyncConfigResponse(BaseModel):
    """Current sync configuration, with the API key redacted.

    ``has_api_key`` tells the UI a key is stored without ever returning it;
    ``athlete_name`` is the display name of the bound canonical athlete.
    """

    provider: str
    athlete_id: str
    athlete_name: str | None = None
    icu_athlete_id: str
    enabled: bool
    has_api_key: bool
    synced_through: datetime | None = None
    last_run_at: datetime | None = None
    last_status: str | None = None
    last_message: str | None = None


class SyncConfigRequest(BaseModel):
    """Create/update the sync configuration. The API key is validated first."""

    athlete_id: str
    api_key: str
    icu_athlete_id: str = "0"
    enabled: bool = True


class SyncTriggerRequest(BaseModel):
    # Ignore the watermark and re-scan from the athlete's earliest anchor.
    full_resync: bool = False


class SyncRunResult(BaseModel):
    """Outcome of a sync run (returned by the trigger endpoint)."""

    status: str  # ok | error
    listed: int = 0
    added: int = 0
    updated: int = 0
    skipped: int = 0
    deduped: int = 0
    enriched: int = 0
    message: str | None = None


class SyncStatusResponse(BaseModel):
    """Pollable last/in-progress sync run state."""

    configured: bool
    enabled: bool = False
    running: bool = False
    synced_through: datetime | None = None
    last_run_at: datetime | None = None
    last_status: str | None = None
    last_message: str | None = None


ActivityDetail.model_rebuild()
MetaResponse.model_rebuild()

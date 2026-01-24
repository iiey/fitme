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
    provider: str = "strava"
    force: bool = False


class ImportResult(BaseModel):
    added: int
    updated: int
    skipped: int
    deduped: int = 0
    gear_upserted: int
    files_parsed: int
    parse_errors: int


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


ActivityDetail.model_rebuild()
MetaResponse.model_rebuild()

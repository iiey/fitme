from __future__ import annotations

from datetime import date, datetime
from statistics import median

from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.domain.threshold import (
    MAX_THRESHOLD_PACE_S_KM,
    MIN_THRESHOLD_PACE_S_KM,
    threshold_pace_from_best_efforts,
)

_DB_FIELDS = (
    "birthday",
    "sex",
    "weight_kg",
    "ftp",
    "max_heart_rate",
    "resting_heart_rate",
    "unit_system",
    "threshold_pace",
    "heart_rate_zones",
    "power_zones",
    "pace_zones",
)

# Canonical labels for the 5 training zones, shared by the API serializers and
# the coach so a "Threshold" zone means the same thing everywhere.
HR_ZONE_LABELS = ["Warm Up", "Easy", "Aerobic", "Threshold", "Maximum"]
PACE_ZONE_LABELS = ["Recovery", "Aerobic", "Tempo", "Sub-Threshold", "VO2 Max"]


class AthleteConfig(BaseModel):
    """Athlete profile loaded from the database."""

    birthday: date | None = None
    sex: str = "M"
    weight_kg: float | None = None
    ftp: int | None = None
    max_heart_rate: int | None = None
    resting_heart_rate: int | None = None
    unit_system: str = "metric"
    heart_rate_zones: list[float] = Field(default_factory=lambda: [0.60, 0.70, 0.80, 0.90])
    power_zones: list[float] = Field(default_factory=lambda: [0.55, 0.75, 0.90, 1.05, 1.20, 1.50])
    threshold_pace: int | None = None
    pace_zones: list[float] = Field(default_factory=lambda: [1.29, 1.14, 1.06, 0.99])

    @property
    def age(self) -> int | None:
        if self.birthday is None:
            return None
        today = datetime.utcnow().date()
        return (
            today.year
            - self.birthday.year
            - ((today.month, today.day) < (self.birthday.month, self.birthday.day))
        )

    def estimated_max_heart_rate(self) -> int | None:
        """Configured max HR, or a Tanaka age-based estimate as a fallback."""
        if self.max_heart_rate:
            return self.max_heart_rate
        if self.age is not None:
            return round(208 - 0.7 * self.age)
        return None

    def hr_zone_boundaries(self) -> list[int] | None:
        """Absolute lower bounds (bpm) of each of the 5 HR zones."""
        max_hr = self.estimated_max_heart_rate()
        if not max_hr:
            return None
        bounds = [0] + [round(frac * max_hr) for frac in self.heart_rate_zones]
        return bounds

    def power_zone_boundaries(self) -> list[int] | None:
        """Absolute upper bounds (watts) of each power zone."""
        if not self.ftp:
            return None
        return [round(frac * self.ftp) for frac in self.power_zones]

    def pace_zone_boundaries(self) -> list[float] | None:
        """Absolute pace boundaries (s/km) between the 5 pace zones, descending."""
        if not self.threshold_pace:
            return None
        return [round(frac * self.threshold_pace) for frac in self.pace_zones]


def estimate_threshold_pace(db: Session, athlete_id: str) -> int | None:
    """Estimate threshold pace (s/km) for an athlete's runs.

    Prefers a Critical Speed fit over the athlete's best-effort curve - the most
    accurate signal, as best efforts capture genuine maximal sustained segments.
    Falls back to the fastest sustained whole runs when too few best efforts
    exist (e.g. activities imported from a CSV without streams).
    """
    pace = _threshold_from_best_efforts(db, athlete_id)
    if pace is not None:
        return pace
    return _threshold_from_runs(db, athlete_id)


def _threshold_from_best_efforts(db: Session, athlete_id: str) -> int | None:
    """Critical Speed estimate from the athlete's all-time best run efforts."""
    from sqlalchemy import func, select

    from app.enums import ActivityType
    from app.models import Activity, BestEffort

    rows = db.execute(
        select(BestEffort.distance_m, func.min(BestEffort.time_s))
        .join(Activity, BestEffort.activity_id == Activity.activity_id)
        .where(
            Activity.athlete_id == athlete_id,
            BestEffort.activity_type == ActivityType.RUN.value,
        )
        .group_by(BestEffort.distance_m)
    ).all()
    points = [(float(time_s), float(distance_m)) for distance_m, time_s in rows]
    return threshold_pace_from_best_efforts(points)


# Whole-run fallback bounds: a hard, sustained continuous run averages close to
# threshold pace, so the fastest such runs are a reasonable proxy. We exclude
# trail runs (terrain depresses pace), very short efforts, and long slow runs.
_FALLBACK_RUN_TYPES = ("Run", "VirtualRun")
_FALLBACK_MIN_DURATION_S = 1500  # 25 min
_FALLBACK_MAX_DURATION_S = 5400  # 90 min
_FALLBACK_SAMPLE_SIZE = 3


def _threshold_from_runs(db: Session, athlete_id: str) -> int | None:
    """Fallback: median pace of the fastest hard, sustained continuous runs."""
    from app.models import Activity

    runs = (
        db.query(Activity.average_speed_ms)
        .filter(
            Activity.athlete_id == athlete_id,
            Activity.sport_type.in_(_FALLBACK_RUN_TYPES),
            Activity.average_speed_ms.isnot(None),
            Activity.average_speed_ms > 0,
            Activity.moving_time_s >= _FALLBACK_MIN_DURATION_S,
            Activity.moving_time_s <= _FALLBACK_MAX_DURATION_S,
        )
        .order_by(Activity.average_speed_ms.desc())
        .limit(_FALLBACK_SAMPLE_SIZE)
        .all()
    )
    if not runs:
        return None
    paces = [round(1000.0 / r.average_speed_ms) for r in runs]
    pace = round(median(paces))
    if not MIN_THRESHOLD_PACE_S_KM <= pace <= MAX_THRESHOLD_PACE_S_KM:
        return None
    return pace


def get_athlete_config(db: Session, athlete_id: str | None) -> AthleteConfig:
    """Load athlete config from the database, using model defaults for unset fields."""
    from app.models import AthleteProfile

    if athlete_id is None:
        return AthleteConfig()
    profile = db.get(AthleteProfile, athlete_id)
    if profile is None:
        return AthleteConfig()

    overrides: dict = {}
    for field in _DB_FIELDS:
        db_value = getattr(profile, field, None)
        if db_value is not None:
            overrides[field] = db_value

    # A stored ``threshold_pace`` is a manual override; otherwise derive it live
    # (and intentionally do not persist it, so it tracks the athlete's fitness).
    if overrides.get("threshold_pace") is None:
        estimated = estimate_threshold_pace(db, athlete_id)
        if estimated is not None:
            overrides["threshold_pace"] = estimated

    return AthleteConfig.model_validate(overrides)

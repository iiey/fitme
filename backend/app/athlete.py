from __future__ import annotations

from datetime import date, datetime
from functools import lru_cache
from pathlib import Path

import yaml
from pydantic import BaseModel, Field

from app.config import settings


class AthleteConfig(BaseModel):
    """Athlete profile loaded from ``config/athlete.yaml``."""

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


def _load_from_disk(path: Path) -> AthleteConfig:
    if not path.exists():
        return AthleteConfig()
    with path.open("r", encoding="utf-8") as fh:
        raw = yaml.safe_load(fh) or {}
    return AthleteConfig.model_validate(raw)


@lru_cache
def get_athlete() -> AthleteConfig:
    return _load_from_disk(settings.athlete_config_path)

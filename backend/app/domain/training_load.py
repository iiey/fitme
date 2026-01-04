from __future__ import annotations

import math
from collections import defaultdict
from datetime import date

from app.athlete import AthleteConfig
from app.enums import ActivityType
from app.models import Activity

# Banister TRIMP weighting factor, by sex.
_BANISTER_K_MALE = 1.92
_BANISTER_K_FEMALE = 1.67
# Lactate-threshold heart rate as a fraction of max HR (zone-5 lower bound).
_LTHR_FRACTION = 0.90
SECONDS_PER_HOUR = 3600


def power_intensity_factor(activity: Activity, athlete: AthleteConfig) -> float | None:
    """Intensity Factor (NP / FTP) for a ride with power data."""
    if activity.activity_type != ActivityType.RIDE.value:
        return None
    if not activity.normalized_power or not athlete.ftp:
        return None
    return activity.normalized_power / athlete.ftp


def heart_rate_intensity(activity: Activity, athlete: AthleteConfig) -> float | None:
    """Heart-rate reserve fraction for the activity's average heart rate."""
    if not activity.average_heart_rate:
        return None
    max_hr = athlete.estimated_max_heart_rate()
    rest_hr = athlete.resting_heart_rate
    if not max_hr or rest_hr is None or max_hr <= rest_hr:
        return None
    fraction = (activity.average_heart_rate - rest_hr) / (max_hr - rest_hr)
    return max(0.0, min(1.0, fraction))


def activity_intensity(activity: Activity, athlete: AthleteConfig) -> int:
    """Single-activity intensity as a 0-100 percentage (power preferred)."""
    intensity_factor = power_intensity_factor(activity, athlete)
    if intensity_factor is not None:
        return round(intensity_factor * 100)
    hr_fraction = heart_rate_intensity(activity, athlete)
    if hr_fraction is not None:
        return round(hr_fraction * 100)
    return 0


def activity_training_load(activity: Activity, athlete: AthleteConfig) -> float:
    """Training-stress score for one activity (power-based TSS or hrTSS)."""
    moving_time_s = activity.moving_time_s or 0
    if moving_time_s <= 0:
        return 0.0

    intensity_factor = power_intensity_factor(activity, athlete)
    if intensity_factor is not None and athlete.ftp:
        return (
            (moving_time_s * activity.normalized_power * intensity_factor)
            / (athlete.ftp * SECONDS_PER_HOUR)
            * 100
        )

    hr_fraction = heart_rate_intensity(activity, athlete)
    if hr_fraction is not None:
        return _hr_training_load(moving_time_s, hr_fraction, athlete)

    return 0.0


def _hr_training_load(moving_time_s: int, intensity: float, athlete: AthleteConfig) -> float:
    """Banister TRIMP normalised to the hrTSS scale (~100 at threshold/hour)."""
    banister_k = _BANISTER_K_MALE if athlete.sex.upper() == "M" else _BANISTER_K_FEMALE
    minutes = moving_time_s / 60.0
    trimp = minutes * intensity * math.exp(banister_k * intensity)

    max_hr = athlete.estimated_max_heart_rate()
    rest_hr = athlete.resting_heart_rate or 0
    lthr = _LTHR_FRACTION * max_hr
    hrr_threshold = (lthr - rest_hr) / (max_hr - rest_hr)
    trimp_threshold = 60 * hrr_threshold * math.exp(banister_k * hrr_threshold)
    if trimp_threshold <= 0:
        return 0.0
    return (trimp / trimp_threshold) * 100


def daily_training_load(activities: list[Activity], athlete: AthleteConfig) -> dict[date, int]:
    """Total training load per calendar day."""
    load_per_day: dict[date, float] = defaultdict(float)
    for activity in activities:
        day = activity.start_date_time.date()
        load_per_day[day] += activity_training_load(activity, athlete)
    return {day: round(load) for day, load in load_per_day.items()}

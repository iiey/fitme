from __future__ import annotations

import math
import statistics
from collections import defaultdict
from datetime import date, timedelta

from app.athlete import AthleteConfig
from app.enums import ActivityType
from app.models import Activity

# Banister TRIMP weighting factor, by sex.
_BANISTER_K_MALE = 1.92
_BANISTER_K_FEMALE = 1.67
# Lactate-threshold heart rate as a fraction of max HR (zone-5 lower bound).
_LTHR_FRACTION = 0.90
SECONDS_PER_HOUR = 3600
# A perfectly uniform week (zero load variance, but non-zero load) is maximally
# monotonous; Foster's mean/std is then undefined, so report this saturated
# high value rather than the "good" 0 the divide-by-zero guard would give.
_UNIFORM_WEEK_MONOTONY = 2.5


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


# ── Training load analysis (CTL / ATL / TSB / monotony / strain) ──

_CTL_DAYS = 42
_ATL_DAYS = 7


def training_load_analysis(
    activities: list[Activity],
    athlete: AthleteConfig,
    anchor: date,
    display_days: int = 42,
) -> dict:
    """Compute CTL/ATL/TSB series and summary metrics.

    Uses the Banister EWMA model. We compute 210 extra warm-up days
    so the exponential averages stabilise before the display window.
    """
    warmup_days = 210
    total_days = display_days + warmup_days
    start = anchor - timedelta(days=total_days - 1)

    load_by_day = daily_training_load(activities, athlete)

    alpha_atl = 1 - math.exp(-1 / _ATL_DAYS)
    alpha_ctl = 1 - math.exp(-1 / _CTL_DAYS)

    ctl = 0.0
    atl = 0.0
    series: list[dict] = []

    for i in range(total_days):
        day = start + timedelta(days=i)
        load = load_by_day.get(day, 0)

        if i == 0:
            ctl = float(load)
            atl = float(load)
        else:
            ctl = load * alpha_ctl + ctl * (1 - alpha_ctl)
            atl = load * alpha_atl + atl * (1 - alpha_atl)

        tsb = ctl - atl

        if i >= warmup_days:
            series.append(
                {
                    "date": day.isoformat(),
                    "load": load,
                    "ctl": round(ctl, 1),
                    "atl": round(atl, 1),
                    "tsb": round(tsb, 1),
                }
            )

    # Current values (last day)
    current_ctl = series[-1]["ctl"] if series else 0
    current_atl = series[-1]["atl"] if series else 0
    current_tsb = series[-1]["tsb"] if series else 0
    ac_ratio = round(current_atl / current_ctl, 2) if current_ctl > 0 else 0

    # Weekly metrics (last 7 days)
    week_loads = [s["load"] for s in series[-7:]]
    weekly_trimp = sum(week_loads)
    mean_load = weekly_trimp / 7 if len(week_loads) == 7 else 0

    if len(week_loads) >= 2:
        std = statistics.pstdev(week_loads)
        if std > 0:
            monotony = round(mean_load / std, 2)
        elif mean_load > 0:
            monotony = _UNIFORM_WEEK_MONOTONY
        else:
            monotony = 0
    else:
        monotony = 0

    strain = round(weekly_trimp * monotony) if monotony else 0

    # Rest days (last 7)
    rest_days = sum(1 for load in week_loads if load == 0)

    # TSB status
    if current_tsb > 25:
        tsb_status = "Risk of detraining"
        tsb_color = "orange"
    elif current_tsb > 10:
        tsb_status = "Peak fresh"
        tsb_color = "green"
    elif current_tsb > 0:
        tsb_status = "Slightly fresh"
        tsb_color = "green"
    elif current_tsb > -10:
        tsb_status = "Neutral – short-term sustainable"
        tsb_color = "neutral"
    elif current_tsb > -30:
        tsb_status = "Accumulated fatigue"
        tsb_color = "yellow"
    else:
        tsb_status = "Over-fatigued"
        tsb_color = "red"

    # A:C ratio status
    if ac_ratio > 1.3:
        ac_status = "High risk"
        ac_color = "red"
    elif ac_ratio >= 0.8:
        ac_status = "Optimal training range"
        ac_color = "green"
    else:
        ac_status = "Low training load"
        ac_color = "yellow"

    return {
        "ctl": current_ctl,
        "atl": current_atl,
        "tsb": current_tsb,
        "tsb_status": tsb_status,
        "tsb_color": tsb_color,
        "ac_ratio": ac_ratio,
        "ac_status": ac_status,
        "ac_color": ac_color,
        "rest_days": rest_days,
        "monotony": monotony,
        "strain": strain,
        "weekly_trimp": weekly_trimp,
        "series": series,
        "display_days": display_days,
    }

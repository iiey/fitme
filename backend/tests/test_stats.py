from __future__ import annotations

from datetime import datetime

from app.athlete import AthleteConfig
from app.domain import stats
from app.domain.training_load import activity_intensity, activity_training_load
from app.enums import ActivityType, SportType
from app.models import Activity


def _activity(**kwargs) -> Activity:
    defaults = {
        "activity_id": "a1",
        "start_date_time": datetime(2024, 4, 1, 7, 0, 0),
        "sport_type": SportType.RIDE.value,
        "activity_type": ActivityType.RIDE.value,
        "name": "Test",
        "distance_m": 30000.0,
        "elevation_m": 300.0,
        "moving_time_s": 3600,
        "elapsed_time_s": 3700,
    }
    defaults.update(kwargs)
    return Activity(**defaults)


def test_overall_totals():
    activities = [_activity(distance_m=10000.0), _activity(distance_m=20000.0)]
    totals = stats.overall_totals(activities)
    assert totals.count == 2
    assert totals.distance_m == 30000.0


def test_weekday_distribution_has_seven_days():
    activities = [_activity()]
    distribution = stats.weekday_distribution(activities)
    assert len(distribution) == 7
    assert sum(t.count for t in distribution.values()) == 1


def test_longest_streak_counts_consecutive_days():
    activities = [
        _activity(start_date_time=datetime(2024, 4, day, 7, 0, 0)) for day in (1, 2, 3, 5)
    ]
    streak = stats.longest_daily_streak(activities)
    assert streak is not None
    assert streak.length == 3


def test_power_training_load_positive_for_ride_with_power():
    athlete = AthleteConfig(ftp=250, max_heart_rate=190, resting_heart_rate=50, sex="M")
    activity = _activity(normalized_power=230.0, moving_time_s=3600)
    intensity = activity_intensity(activity, athlete)
    load = activity_training_load(activity, athlete)
    assert intensity > 0
    # IF = 230/250 = 0.92, TSS for 1h ~ 0.92^2 * 100 ~ 85
    assert 70 < load < 100


def test_hr_training_load_used_without_power():
    athlete = AthleteConfig(ftp=None, max_heart_rate=190, resting_heart_rate=50, sex="M")
    activity = _activity(
        sport_type=SportType.RUN.value,
        activity_type=ActivityType.RUN.value,
        normalized_power=None,
        average_heart_rate=150,
        moving_time_s=3600,
    )
    load = activity_training_load(activity, athlete)
    assert load > 0


def test_distance_breakdown_buckets():
    activities = [_activity(distance_m=3000.0), _activity(distance_m=15000.0)]
    breakdown = stats.distance_breakdown(activities)
    assert breakdown["0-5 km"].count == 1
    assert breakdown["10-20 km"].count == 1

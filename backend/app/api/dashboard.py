from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import repository
from app.api.serializers import serialize_activity_summary, serialize_gear
from app.athlete import get_athlete
from app.db import get_db
from app.domain import stats
from app.domain.eddington import compute_eddington
from app.domain.milestones import discover_milestones
from app.domain.streams_analysis import (
    PEAK_POWER_DURATIONS,
    peak_power_outputs,
    time_in_hr_zones,
)
from app.domain.training_load import daily_training_load
from app.domain.units import distance_for_unit, elevation_for_unit
from app.enums import ActivityType, SportType
from app.models import BestEffort

router = APIRouter(prefix="/api/dashboard", tags=["dashboard"])

RECENT_ACTIVITY_COUNT = 5
WEEKLY_STATS_WEEKS = 26
HR_ZONES_WINDOW_DAYS = 30
PEAK_POWER_WINDOW_DAYS = 120
TRAINING_LOAD_WINDOW_DAYS = 90
CALENDAR_WINDOW_DAYS = 365


def _totals_payload(totals: stats.Totals, unit_system: str) -> dict:
    return {
        "count": totals.count,
        "distance": round(distance_for_unit(totals.distance_m, unit_system), 1),
        "elevation": round(elevation_for_unit(totals.elevation_m, unit_system), 0),
        "moving_time_s": totals.moving_time_s,
        "calories": totals.calories,
    }


def _weekly_stats(activities, unit_system: str) -> list[dict]:
    per_week = stats.totals_per_period(activities, "week")
    items = [
        {"period": period, **_totals_payload(totals, unit_system)}
        for period, totals in per_week.items()
    ]
    return items[-WEEKLY_STATS_WEEKS:]


def _monthly_stats(activities, unit_system: str) -> list[dict]:
    per_month = stats.totals_per_period(activities, "month")
    return [
        {"period": period, **_totals_payload(totals, unit_system)}
        for period, totals in per_month.items()
    ]


def _yearly_stats(activities, unit_system: str) -> list[dict]:
    per_year = stats.totals_per_period(activities, "year")
    return [
        {"period": period, **_totals_payload(totals, unit_system)}
        for period, totals in per_year.items()
    ]


def _distribution_payload(distribution: dict[str, stats.Totals], unit_system: str) -> list[dict]:
    return [
        {"label": label, **_totals_payload(totals, unit_system)}
        for label, totals in distribution.items()
    ]


def _activity_calendar(activities, athlete, unit_system: str, anchor: datetime) -> list[dict]:
    cutoff = anchor.date() - timedelta(days=CALENDAR_WINDOW_DAYS)
    recent = [a for a in activities if a.start_date_time.date() >= cutoff]
    days = stats.calendar_days(recent)
    load_by_day = daily_training_load(recent, athlete)
    return [
        {
            "date": day.isoformat(),
            "count": cell.count,
            "distance": round(distance_for_unit(cell.distance_m, unit_system), 1),
            "moving_time_s": cell.moving_time_s,
            "training_load": load_by_day.get(day, 0),
        }
        for day, cell in sorted(days.items())
    ]


def _eddington_summary(activities, unit_system: str) -> list[dict]:
    grouped: dict[str, dict] = defaultdict(lambda: defaultdict(float))
    for activity in activities:
        sport = SportType.from_strava(activity.sport_type)
        if not sport.is_distance_based:
            continue
        day = activity.start_date_time.date()
        grouped[activity.activity_type][day] += distance_for_unit(activity.distance_m, unit_system)

    results = []
    for activity_type, distances in grouped.items():
        result = compute_eddington(dict(distances))
        if result.number > 0:
            results.append(
                {
                    "activity_type": activity_type,
                    "number": result.number,
                    "longest_day": result.longest_day,
                    "next": result.number + 1,
                    "days_to_next": result.days_to_next.get(result.number + 1),
                }
            )
    results.sort(key=lambda item: item["number"], reverse=True)
    return results


def _hr_zones(db: Session, activities, athlete, anchor: datetime) -> dict | None:
    bounds = athlete.hr_zone_boundaries()
    if not bounds:
        return None
    cutoff = anchor - timedelta(days=HR_ZONES_WINDOW_DAYS)
    recent = [a for a in activities if a.start_date_time >= cutoff and a.average_heart_rate]
    zones = [0, 0, 0, 0, 0]
    for activity in recent:
        streams = repository.streams_for_activity(db, activity.activity_id)
        for index, seconds in enumerate(time_in_hr_zones(streams, bounds)):
            zones[index] += seconds
    if not any(zones):
        return None
    return {"zones": zones, "window_days": HR_ZONES_WINDOW_DAYS}


def _peak_power(db: Session, activities, anchor: datetime) -> dict | None:
    cutoff = anchor - timedelta(days=PEAK_POWER_WINDOW_DAYS)
    rides = [
        a
        for a in activities
        if a.activity_type == ActivityType.RIDE.value
        and a.start_date_time >= cutoff
        and a.average_power
    ]
    best: dict[int, float] = {}
    for activity in rides:
        streams = repository.streams_for_activity(db, activity.activity_id)
        for duration, watts in peak_power_outputs(streams).items():
            if watts > best.get(duration, 0):
                best[duration] = watts
    if not best:
        return None
    return {
        "durations": PEAK_POWER_DURATIONS,
        "outputs": [{"duration_s": d, "watts": best.get(d)} for d in PEAK_POWER_DURATIONS],
        "window_days": PEAK_POWER_WINDOW_DAYS,
    }


def _training_load(activities, athlete, anchor: datetime) -> list[dict]:
    cutoff = anchor.date() - timedelta(days=TRAINING_LOAD_WINDOW_DAYS)
    recent = [a for a in activities if a.start_date_time.date() >= cutoff]
    load_by_day = daily_training_load(recent, athlete)
    return [{"date": day.isoformat(), "load": load} for day, load in sorted(load_by_day.items())]


def _apply_dashboard_filters(activities, sport_type, start, end):
    """Filter the activity set by sport type and an inclusive date range."""
    sport_set = set(sport_type) if sport_type else None
    result = []
    for activity in activities:
        if sport_set and activity.sport_type not in sport_set:
            continue
        if start and activity.start_date_time < start:
            continue
        if end and activity.start_date_time > end:
            continue
        result.append(activity)
    return result


@router.get("")
def get_dashboard(
    db: Session = Depends(get_db),
    sport_type: list[str] | None = Query(default=None),
    start: datetime | None = None,
    end: datetime | None = None,
) -> dict:
    athlete = get_athlete()
    unit_system = athlete.unit_system
    all_activities = repository.all_activities(db)

    if not all_activities:
        return {"empty": True, "unit_system": unit_system, "available_years": []}

    # Available years come from the full set so the selector stays stable.
    available_years = sorted({a.start_date_time.year for a in all_activities}, reverse=True)

    activities = _apply_dashboard_filters(all_activities, sport_type, start, end)
    if not activities:
        return {
            "empty": False,
            "filtered_empty": True,
            "unit_system": unit_system,
            "available_years": available_years,
        }

    recent_sorted = sorted(activities, key=lambda a: a.start_date_time, reverse=True)
    # Anchor rolling windows on the most recent activity so that an imported
    # historical export still shows meaningful "recent" widgets.
    anchor = recent_sorted[0].start_date_time
    best_efforts = list(db.execute(select(BestEffort)).scalars().all())
    milestones = discover_milestones(activities, best_efforts, unit_system)
    longest_streak = stats.longest_daily_streak(activities)

    return {
        "empty": False,
        "filtered_empty": False,
        "available_years": available_years,
        "unit_system": unit_system,
        "totals": _totals_payload(stats.overall_totals(activities), unit_system),
        "recent_activities": [
            serialize_activity_summary(a).model_dump()
            for a in recent_sorted[:RECENT_ACTIVITY_COUNT]
        ],
        "weekly_stats": _weekly_stats(activities, unit_system),
        "monthly_stats": _monthly_stats(activities, unit_system),
        "yearly_stats": _yearly_stats(activities, unit_system),
        "activity_calendar": _activity_calendar(activities, athlete, unit_system, anchor),
        "streaks": {
            "current": stats.current_daily_streak(activities, anchor.date()),
            "longest": longest_streak.length if longest_streak else 0,
        },
        "eddington": _eddington_summary(activities, unit_system),
        "weekday_stats": _distribution_payload(stats.weekday_distribution(activities), unit_system),
        "daytime_stats": _distribution_payload(stats.daytime_distribution(activities), unit_system),
        "distance_breakdown": _distribution_payload(
            stats.distance_breakdown(activities), unit_system
        ),
        "hr_zones": _hr_zones(db, activities, athlete, anchor),
        "peak_power": _peak_power(db, activities, anchor),
        "training_load": _training_load(activities, athlete, anchor),
        "recent_milestones": [m.as_dict() for m in milestones[:RECENT_ACTIVITY_COUNT]],
        "gear_stats": [serialize_gear(g).model_dump() for g in repository.list_gear(db)],
    }

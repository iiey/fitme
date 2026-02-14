from __future__ import annotations

from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import repository
from app.api.athletes import get_athlete_id
from app.api.serializers import serialize_activity_summary, serialize_gear
from app.athlete import get_athlete_config
from app.db import get_db
from app.domain import stats
from app.domain.eddington import compute_eddington
from app.domain.milestones import discover_milestones
from app.domain.streams_analysis import (
    PEAK_POWER_DURATIONS,
    peak_power_outputs,
    time_in_hr_zones,
)
from app.domain.training_load import (
    activity_intensity,
    activity_training_load,
    daily_training_load,
    training_load_analysis,
)
from app.domain.units import distance_for_unit, elevation_for_unit
from app.domain.vo2max import RUNNING_TYPES, vo2max_trend
from app.enums import ActivityType, SportType
from app.models import BestEffort

router = APIRouter(prefix="/api/dashboard", tags=["dashboard"])

RECENT_ACTIVITY_COUNT = 5
WEEKLY_STATS_WEEKS = 26
HR_ZONES_WINDOW_DAYS = 30
PEAK_POWER_WINDOW_DAYS = 120
TRAINING_LOAD_WINDOW_DAYS = 90
TRAINING_LOAD_ANALYSIS_DAYS = 90
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


def _hr_zones(
    activities,
    athlete,
    anchor: datetime,
    all_streams: dict,
    window_days: int = HR_ZONES_WINDOW_DAYS,
) -> dict | None:
    bounds = athlete.hr_zone_boundaries()
    if not bounds:
        return None
    cutoff = anchor - timedelta(days=window_days)
    recent = [a for a in activities if a.start_date_time >= cutoff and a.average_heart_rate]
    if not recent:
        return None
    zones = [0, 0, 0, 0, 0]
    for activity in recent:
        streams = all_streams.get(activity.activity_id, {})
        for index, seconds in enumerate(time_in_hr_zones(streams, bounds)):
            zones[index] += seconds
    if not any(zones):
        return None
    return {"zones": zones, "window_days": window_days}


def _peak_power(
    activities,
    anchor: datetime,
    all_streams: dict,
    window_days: int = PEAK_POWER_WINDOW_DAYS,
) -> dict | None:
    cutoff = anchor - timedelta(days=window_days)
    rides = [
        a
        for a in activities
        if a.activity_type == ActivityType.RIDE.value
        and a.start_date_time >= cutoff
        and a.average_power
    ]
    if not rides:
        return None
    best: dict[int, float] = {}
    for activity in rides:
        streams = all_streams.get(activity.activity_id, {})
        for duration, watts in peak_power_outputs(streams).items():
            if watts > best.get(duration, 0):
                best[duration] = watts
    if not best:
        return None
    return {
        "durations": PEAK_POWER_DURATIONS,
        "outputs": [{"duration_s": d, "watts": best.get(d)} for d in PEAK_POWER_DURATIONS],
        "window_days": window_days,
    }


def _training_load(activities, athlete, anchor: datetime) -> list[dict]:
    cutoff = anchor.date() - timedelta(days=TRAINING_LOAD_WINDOW_DAYS)
    recent = [a for a in activities if a.start_date_time.date() >= cutoff]
    load_by_day = daily_training_load(recent, athlete)
    return [{"date": day.isoformat(), "load": load} for day, load in sorted(load_by_day.items())]


def _training_load_analysis(activities, athlete, anchor: datetime) -> dict:
    """CTL/ATL/TSB analysis enriched with each day's activities.

    The per-day activity list powers the dashboard's hover panel, letting the
    user jump from a point on the fitness curve straight to that day's rides.
    """
    analysis = training_load_analysis(
        activities, athlete, anchor.date(), display_days=TRAINING_LOAD_ANALYSIS_DAYS
    )

    activities_by_day: dict[str, list[dict]] = defaultdict(list)
    for activity in activities:
        day = activity.start_date_time.date().isoformat()
        summary = serialize_activity_summary(activity).model_dump()
        summary["load"] = round(activity_training_load(activity, athlete))
        summary["intensity"] = activity_intensity(activity, athlete)
        activities_by_day[day].append(summary)

    for entry in analysis["series"]:
        entry["activities"] = activities_by_day.get(entry["date"], [])
    return analysis


@router.get("")
def get_dashboard(
    db: Session = Depends(get_db),
    athlete_id: str | None = Depends(get_athlete_id),
    sport_type: list[str] | None = Query(default=None),
    start: datetime | None = None,
    end: datetime | None = None,
    hr_window: int | None = Query(default=None, ge=7, le=365),
    power_window: int | None = Query(default=None, ge=7, le=365),
) -> dict:
    athlete = get_athlete_config(db, athlete_id)
    unit_system = athlete.unit_system

    if athlete_id is None:
        return {"empty": True, "unit_system": unit_system, "available_years": []}

    available_years = repository.distinct_years(db, athlete_id)
    if not available_years:
        return {"empty": True, "unit_system": unit_system, "available_years": []}

    activities = repository.list_activities(
        db,
        athlete_id,
        sport_types=sport_type,
        start=start,
        end=end,
        descending=False,
    )
    if not activities:
        return {
            "empty": False,
            "filtered_empty": True,
            "unit_system": unit_system,
            "available_years": available_years,
        }

    hr_window_days = hr_window or HR_ZONES_WINDOW_DAYS
    power_window_days = power_window or PEAK_POWER_WINDOW_DAYS

    recent_sorted = sorted(activities, key=lambda a: a.start_date_time, reverse=True)
    anchor = recent_sorted[0].start_date_time

    # ── Pre-fetch all DB data before parallel section ──
    activity_ids = [a.activity_id for a in activities]
    best_efforts = (
        list(
            db.execute(select(BestEffort).where(BestEffort.activity_id.in_(activity_ids)))
            .scalars()
            .all()
        )
        if activity_ids
        else []
    )
    # Streams are the dashboard's heaviest read - each is a compressed BLOB that
    # must be decompressed and JSON-parsed. Only three sections consume them, and
    # only for a subset of activities: HR zones and peak power look at the recent
    # window, while the VO2max trend needs every run. Loading streams for just
    # those activities avoids decompressing the entire history on a cache miss.
    stream_cutoff = anchor - timedelta(days=max(hr_window_days, power_window_days))
    stream_ids = [
        a.activity_id
        for a in activities
        if a.start_date_time >= stream_cutoff or a.sport_type in RUNNING_TYPES
    ]
    all_streams = repository.streams_for_activities(
        db,
        stream_ids,
        stream_types=["heartrate", "time", "watts", "distance", "altitude"],
    )
    gear = repository.list_gear(db, athlete_id)

    # ── Run CPU-bound computations in parallel ──
    results: dict[str, object] = {}
    with ThreadPoolExecutor(max_workers=4) as pool:
        futures = {
            pool.submit(_weekly_stats, activities, unit_system): "weekly_stats",
            pool.submit(_monthly_stats, activities, unit_system): "monthly_stats",
            pool.submit(_yearly_stats, activities, unit_system): "yearly_stats",
            pool.submit(
                _activity_calendar, activities, athlete, unit_system, anchor
            ): "activity_calendar",
            pool.submit(_eddington_summary, activities, unit_system): "eddington",
            pool.submit(
                _distribution_payload,
                stats.weekday_distribution(activities),
                unit_system,
            ): "weekday_stats",
            pool.submit(
                _distribution_payload,
                stats.daytime_distribution(activities),
                unit_system,
            ): "daytime_stats",
            pool.submit(
                _distribution_payload,
                stats.distance_breakdown(activities),
                unit_system,
            ): "distance_breakdown",
            pool.submit(
                _hr_zones, activities, athlete, anchor, all_streams, hr_window_days
            ): "hr_zones",
            pool.submit(
                _peak_power, activities, anchor, all_streams, power_window_days
            ): "peak_power",
            pool.submit(_training_load, activities, athlete, anchor): "training_load",
            pool.submit(
                vo2max_trend,
                activities,
                athlete.estimated_max_heart_rate(),
                athlete.resting_heart_rate,
                streams=all_streams,
            ): "vo2max_trend",
            pool.submit(
                _training_load_analysis, activities, athlete, anchor
            ): "training_load_analysis",
            pool.submit(discover_milestones, activities, best_efforts, unit_system): "milestones",
            pool.submit(stats.longest_daily_streak, activities): "longest_streak",
        }
        for future in as_completed(futures):
            results[futures[future]] = future.result()

    longest_streak = results["longest_streak"]
    milestones = results["milestones"]
    current_streak = stats.current_daily_streak(activities, anchor.date())
    weekday_hr = stats.weekday_average_hr(activities)

    weekday_stats_raw: list[dict] = results["weekday_stats"]  # type: ignore[assignment]
    for entry in weekday_stats_raw:
        entry["average_heart_rate"] = weekday_hr.get(entry["label"])

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
        "weekly_stats": results["weekly_stats"],
        "monthly_stats": results["monthly_stats"],
        "yearly_stats": results["yearly_stats"],
        "activity_calendar": results["activity_calendar"],
        "streaks": {
            "current": current_streak.length if current_streak else 0,
            "longest": longest_streak.length if longest_streak else 0,
            "current_start": (current_streak.start.isoformat() if current_streak else None),
        },
        "eddington": results["eddington"],
        "weekday_stats": weekday_stats_raw,
        "daytime_stats": results["daytime_stats"],
        "distance_breakdown": results["distance_breakdown"],
        "hr_zones": results["hr_zones"],
        "peak_power": results["peak_power"],
        "training_load": results["training_load"],
        "training_load_analysis": results["training_load_analysis"],
        "vo2max_trend": results["vo2max_trend"],
        "recent_milestones": [m.as_dict() for m in milestones[:RECENT_ACTIVITY_COUNT]],
        "gear_stats": [serialize_gear(g).model_dump() for g in gear],
    }

from __future__ import annotations

import calendar as _calendar
from datetime import date, datetime, timedelta

from app.domain.stats import longest_daily_streak, totals_per_sport_type
from app.domain.units import distance_for_unit, distance_unit_label
from app.enums import ActivityType, SportType
from app.models import Activity

# Fun-equivalent constants.
KCAL_PER_PIZZA_SLICE = 285
KCAL_PER_BANANA = 105
# Average car tailpipe emissions, kg CO2 per km, displaced by human-powered travel.
CAR_CO2_KG_PER_KM = 0.18
CO2_KG_PER_GOOGLE_SEARCH = 0.0002
CO2_KG_PER_PLASTIC_BOTTLE = 0.082

_HUMAN_POWERED = {ActivityType.RIDE, ActivityType.RUN, ActivityType.WALK}


def available_years(activities: list[Activity]) -> list[int]:
    return sorted({a.start_date_time.year for a in activities}, reverse=True)


def _filter_year(activities: list[Activity], year: int | None) -> list[Activity]:
    if year is None:
        return activities
    return [a for a in activities if a.start_date_time.year == year]


def _filter_days(activities: list[Activity], days: int) -> list[Activity]:
    cutoff = datetime.utcnow() - timedelta(days=days)
    return [a for a in activities if a.start_date_time >= cutoff]


def _totals_per_month(activities: list[Activity], unit_system: str) -> list[dict]:
    buckets: dict[int, dict] = {
        month: {
            "month": _calendar.month_abbr[month],
            "distance": 0.0,
            "count": 0,
            "moving_time_s": 0,
        }
        for month in range(1, 13)
    }
    for activity in activities:
        bucket = buckets[activity.start_date_time.month]
        bucket["distance"] += distance_for_unit(activity.distance_m, unit_system)
        bucket["count"] += 1
        bucket["moving_time_s"] += activity.moving_time_s or 0
    for bucket in buckets.values():
        bucket["distance"] = round(bucket["distance"], 1)
    return list(buckets.values())


def _moving_time_per_sport(activities: list[Activity]) -> list[dict]:
    totals = totals_per_sport_type(activities)
    rows = [
        {
            "sport_type": sport_type,
            "label": SportType.from_strava(sport_type).label,
            "moving_time_s": totals[sport_type].moving_time_s,
        }
        for sport_type in totals
    ]
    rows.sort(key=lambda row: row["moving_time_s"], reverse=True)
    return rows


def _start_times(activities: list[Activity]) -> list[int]:
    counts = [0] * 24
    for activity in activities:
        counts[activity.start_date_time.hour] += 1
    return counts


def _locations(activities: list[Activity]) -> list[dict]:
    points = []
    for activity in activities:
        if activity.start_latitude is not None and activity.start_longitude is not None:
            points.append(
                {
                    "lat": activity.start_latitude,
                    "lng": activity.start_longitude,
                    "sport_type": activity.sport_type,
                }
            )
    return points


def _biggest_activity(activities: list[Activity], unit_system: str) -> dict | None:
    if not activities:
        return None
    biggest = max(activities, key=lambda a: a.distance_m or 0.0)
    if not biggest.distance_m:
        return None
    return {
        "activity_id": biggest.activity_id,
        "name": biggest.name,
        "date": biggest.start_date_time.date().isoformat(),
        "distance": round(distance_for_unit(biggest.distance_m, unit_system), 1),
        "elevation_m": round(biggest.elevation_m, 0),
        "moving_time_s": biggest.moving_time_s,
        "polyline": biggest.polyline,
    }


def _calories(activities: list[Activity]) -> dict:
    total = sum(a.calories or 0 for a in activities)
    return {
        "total": total,
        "pizza_slices": round(total / KCAL_PER_PIZZA_SLICE, 1) if total else 0,
        "bananas": round(total / KCAL_PER_BANANA, 1) if total else 0,
    }


def _carbon_saved(activities: list[Activity]) -> dict:
    distance_km = sum(
        (a.distance_m or 0.0) / 1000.0
        for a in activities
        if SportType.from_strava(a.sport_type).activity_type in _HUMAN_POWERED
    )
    co2_kg = distance_km * CAR_CO2_KG_PER_KM
    return {
        "co2_kg": round(co2_kg, 1),
        "google_searches": round(co2_kg / CO2_KG_PER_GOOGLE_SEARCH) if co2_kg else 0,
        "plastic_bottles": round(co2_kg / CO2_KG_PER_PLASTIC_BOTTLE) if co2_kg else 0,
    }


def _active_vs_rest(
    activities: list[Activity],
    year: int | None,
    days: int | None = None,
) -> dict:
    active_days = {a.start_date_time.date() for a in activities}
    if days is not None:
        total_days = days
    elif year is None:
        total_days = (max(active_days) - min(active_days)).days + 1 if active_days else 0
    else:
        today = datetime.utcnow().date()
        end = min(date(year, 12, 31), today) if year == today.year else date(year, 12, 31)
        total_days = (end - date(year, 1, 1)).days + 1
    return {
        "active_days": len(active_days),
        "rest_days": max(0, total_days - len(active_days)),
        "total_days": total_days,
    }


def build_rewind(
    activities: list[Activity],
    year: int | None,
    unit_system: str,
    days: int | None = None,
) -> dict:
    scoped = _filter_days(activities, days) if days else _filter_year(activities, year)
    total_distance = sum(a.distance_m for a in scoped)
    total_elevation = sum(a.elevation_m for a in scoped)
    total_moving = sum(a.moving_time_s for a in scoped)
    streak = longest_daily_streak(scoped)

    return {
        "year": year,
        "unit": distance_unit_label(unit_system),
        "summary": {
            "count": len(scoped),
            "distance": round(distance_for_unit(total_distance, unit_system), 1),
            "elevation_m": round(total_elevation, 0),
            "moving_time_s": total_moving,
        },
        "totals_per_month": _totals_per_month(scoped, unit_system),
        "moving_time_per_sport": _moving_time_per_sport(scoped),
        "start_times": _start_times(scoped),
        "locations": _locations(scoped),
        "biggest_activity": _biggest_activity(scoped, unit_system),
        "calories": _calories(scoped),
        "carbon_saved": _carbon_saved(scoped),
        "active_vs_rest": _active_vs_rest(scoped, year, days),
        "longest_streak": (
            {
                "length": streak.length,
                "start": streak.start.isoformat(),
                "end": streak.end.isoformat(),
            }
            if streak
            else None
        ),
    }

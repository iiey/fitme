from __future__ import annotations

import calendar as _calendar
from datetime import date, datetime, timedelta

from app.domain.best_efforts import DISTANCE_LABELS
from app.domain.stats import longest_daily_streak, totals_per_sport_type
from app.domain.units import distance_for_unit, distance_unit_label
from app.enums import ActivityType, SportType
from app.models import Activity, BestEffort

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


def _per_sport(activities: list[Activity], unit_system: str) -> list[dict]:
    """Per-sport totals carrying both distance (athlete unit) and moving time,
    so the UI can switch the breakdown between the two metrics."""
    totals = totals_per_sport_type(activities)
    rows = [
        {
            "sport_type": sport_type,
            "label": SportType.from_strava(sport_type).label,
            "moving_time_s": totals[sport_type].moving_time_s,
            "distance": round(distance_for_unit(totals[sport_type].distance_m, unit_system), 1),
        }
        for sport_type in totals
    ]
    rows.sort(key=lambda row: row["moving_time_s"], reverse=True)
    return rows


_HEADLINE_PR_DISTANCES = [400, 1000, 5000, 10000, 21097, 42195]


def _best_achievements(
    activities: list[Activity],
    best_efforts: list[BestEffort],
    unit_system: str,
) -> dict:
    """Highlight the standout efforts within the scoped window.

    Combines single-activity highlights (longest, most climbing, longest, most
    calories) with the fastest times over standard distances (personal records
    for the window), so the user gets a quick "year in sport" style recap.
    """
    if not activities:
        return {"highlights": [], "personal_records": []}

    distance_unit = distance_unit_label(unit_system)
    highlights: list[dict] = []

    def add(label: str, icon: str, activity: Activity, value: float, unit: str) -> None:
        highlights.append(
            {
                "label": label,
                "icon": icon,
                "value": value,
                "unit": unit,
                "activity_id": activity.activity_id,
                "name": activity.name,
                "date": activity.start_date_time.date().isoformat(),
            }
        )

    longest = max(activities, key=lambda a: a.distance_m or 0.0)
    if longest.distance_m:
        add(
            "Longest distance",
            "📏",
            longest,
            round(distance_for_unit(longest.distance_m, unit_system), 1),
            distance_unit,
        )
    climb = max(activities, key=lambda a: a.elevation_m or 0.0)
    if climb.elevation_m:
        add("Biggest climb", "⛰️", climb, round(climb.elevation_m, 0), "m")
    longest_time = max(activities, key=lambda a: a.moving_time_s or 0)
    if longest_time.moving_time_s:
        add(
            "Longest duration",
            "⏱️",
            longest_time,
            longest_time.moving_time_s,
            "duration",
        )
    most_cal = max(activities, key=lambda a: a.calories or 0)
    if most_cal.calories:
        add("Most calories", "🔥", most_cal, most_cal.calories, "kcal")

    scoped_ids = {a.activity_id for a in activities}
    fastest: dict[int, BestEffort] = {}
    for effort in best_efforts:
        if effort.activity_id not in scoped_ids:
            continue
        if effort.distance_m not in _HEADLINE_PR_DISTANCES:
            continue
        current = fastest.get(effort.distance_m)
        if current is None or effort.time_s < current.time_s:
            fastest[effort.distance_m] = effort

    personal_records = [
        {
            "distance_m": distance_m,
            "label": DISTANCE_LABELS.get(distance_m, f"{distance_m} m"),
            "time_s": round(fastest[distance_m].time_s),
            "activity_id": fastest[distance_m].activity_id,
            "date": fastest[distance_m].start_date_time.date().isoformat(),
        }
        for distance_m in sorted(fastest)
    ]

    return {"highlights": highlights, "personal_records": personal_records}


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
    best_efforts: list[BestEffort] | None = None,
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
        "per_sport": _per_sport(scoped, unit_system),
        "achievements": _best_achievements(scoped, best_efforts or [], unit_system),
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

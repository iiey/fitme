from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta

from app.models import Activity

WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]

# Distance buckets in metres, used for the "distance breakdown" widget.
DISTANCE_BUCKETS_M = [
    (0, 5_000, "0-5 km"),
    (5_000, 10_000, "5-10 km"),
    (10_000, 20_000, "10-20 km"),
    (20_000, 40_000, "20-40 km"),
    (40_000, 60_000, "40-60 km"),
    (60_000, 100_000, "60-100 km"),
    (100_000, float("inf"), "100+ km"),
]


@dataclass
class Totals:
    count: int = 0
    distance_m: float = 0.0
    elevation_m: float = 0.0
    moving_time_s: int = 0
    calories: int = 0

    def add(self, activity: Activity) -> None:
        self.count += 1
        self.distance_m += activity.distance_m or 0.0
        self.elevation_m += activity.elevation_m or 0.0
        self.moving_time_s += activity.moving_time_s or 0
        self.calories += activity.calories or 0


def overall_totals(activities: list[Activity]) -> Totals:
    totals = Totals()
    for activity in activities:
        totals.add(activity)
    return totals


def _period_key(activity: Activity, granularity: str) -> str:
    moment = activity.start_date_time
    if granularity == "year":
        return f"{moment.year:04d}"
    if granularity == "month":
        return f"{moment.year:04d}-{moment.month:02d}"
    if granularity == "week":
        iso = moment.isocalendar()
        return f"{iso[0]:04d}-W{iso[1]:02d}"
    return moment.date().isoformat()


def totals_per_period(activities: list[Activity], granularity: str) -> dict[str, Totals]:
    """Aggregate totals keyed by year / month / week / day."""
    buckets: dict[str, Totals] = defaultdict(Totals)
    for activity in activities:
        buckets[_period_key(activity, granularity)].add(activity)
    return dict(sorted(buckets.items()))


def totals_per_sport_type(activities: list[Activity]) -> dict[str, Totals]:
    buckets: dict[str, Totals] = defaultdict(Totals)
    for activity in activities:
        buckets[activity.sport_type].add(activity)
    return dict(buckets)


def totals_per_activity_type(activities: list[Activity]) -> dict[str, Totals]:
    buckets: dict[str, Totals] = defaultdict(Totals)
    for activity in activities:
        buckets[activity.activity_type].add(activity)
    return dict(buckets)


def weekday_distribution(activities: list[Activity]) -> dict[str, Totals]:
    buckets: dict[int, Totals] = defaultdict(Totals)
    for activity in activities:
        buckets[activity.start_date_time.weekday()].add(activity)
    return {WEEKDAY_LABELS[i]: buckets.get(i, Totals()) for i in range(7)}


def daytime_label(hour: int) -> str:
    # Treat the early-morning hours (from 05:00) as "Morning": endurance
    # athletes routinely start training at 5–6 AM, which is not "Night".
    if 5 <= hour < 12:
        return "Morning"
    if 12 <= hour < 18:
        return "Afternoon"
    if 18 <= hour < 24:
        return "Evening"
    return "Night"


def daytime_distribution(activities: list[Activity]) -> dict[str, Totals]:
    order = ["Morning", "Afternoon", "Evening", "Night"]
    buckets: dict[str, Totals] = defaultdict(Totals)
    for activity in activities:
        buckets[daytime_label(activity.start_date_time.hour)].add(activity)
    return {label: buckets.get(label, Totals()) for label in order}


def distance_breakdown(activities: list[Activity]) -> dict[str, Totals]:
    buckets: dict[str, Totals] = {label: Totals() for _, _, label in DISTANCE_BUCKETS_M}
    for activity in activities:
        distance = activity.distance_m or 0.0
        for lower, upper, label in DISTANCE_BUCKETS_M:
            if lower <= distance < upper:
                buckets[label].add(activity)
                break
    return buckets


def start_times_per_hour(activities: list[Activity]) -> dict[int, int]:
    counts = dict.fromkeys(range(24), 0)
    for activity in activities:
        counts[activity.start_date_time.hour] += 1
    return counts


@dataclass
class Streak:
    length: int
    start: date
    end: date


def longest_daily_streak(activities: list[Activity]) -> Streak | None:
    """Longest run of consecutive calendar days with at least one activity."""
    active_days = sorted({a.start_date_time.date() for a in activities})
    if not active_days:
        return None

    best = Streak(1, active_days[0], active_days[0])
    current_start = active_days[0]
    current_len = 1
    for previous, current in zip(active_days, active_days[1:], strict=False):
        if current - previous == timedelta(days=1):
            current_len += 1
        else:
            current_start = current
            current_len = 1
        if current_len > best.length:
            best = Streak(current_len, current_start, current)
    return best


def current_daily_streak(activities: list[Activity], reference: date | None = None) -> int:
    """Number of consecutive active days ending today (or yesterday)."""
    active_days = {a.start_date_time.date() for a in activities}
    if not active_days:
        return 0
    today = reference or datetime.utcnow().date()
    cursor = today if today in active_days else today - timedelta(days=1)
    streak = 0
    while cursor in active_days:
        streak += 1
        cursor -= timedelta(days=1)
    return streak


@dataclass
class CalendarDay:
    day: date
    count: int = 0
    distance_m: float = 0.0
    moving_time_s: int = 0
    training_load: int = 0
    sport_types: set[str] = field(default_factory=set)


def calendar_days(activities: list[Activity]) -> dict[date, CalendarDay]:
    """Per-day aggregates used by the activity heatmap and monthly calendar."""
    days: dict[date, CalendarDay] = {}
    for activity in activities:
        day = activity.start_date_time.date()
        entry = days.setdefault(day, CalendarDay(day=day))
        entry.count += 1
        entry.distance_m += activity.distance_m or 0.0
        entry.moving_time_s += activity.moving_time_s or 0
        entry.sport_types.add(activity.sport_type)
    return days

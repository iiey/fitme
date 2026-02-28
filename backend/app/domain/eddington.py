from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from functools import lru_cache


@dataclass
class EddingtonResult:
    """Eddington number plus the data needed to chart it.

    The Eddington number ``E`` is the largest integer such that the athlete has
    covered at least ``E`` units of distance on at least ``E`` separate days.
    """

    number: int = 0
    unit: str = "km"
    longest_day: int = 0
    # times_completed[d] = number of days with distance >= d  (for d in 1..longest_day)
    times_completed: dict[int, int] = field(default_factory=dict)
    # days_to_next[d] = additional qualifying days needed to reach Eddington d
    days_to_next: dict[int, int] = field(default_factory=dict)
    # history[d] = the date on which Eddington number d was first achieved
    history: dict[int, date] = field(default_factory=dict)


def daily_distances(activities: list[tuple[date, float]]) -> dict[date, float]:
    """Aggregate per-activity ``(day, distance)`` pairs into a per-day total."""
    totals: dict[date, float] = {}
    for day, distance in activities:
        totals[day] = totals.get(day, 0.0) + distance
    return totals


def _times_completed(distances_per_day: dict[date, float]) -> dict[int, int]:
    """For each integer distance d, count days whose total distance >= d."""
    counts: dict[int, int] = {}
    for distance in distances_per_day.values():
        for d in range(1, int(distance) + 1):
            counts[d] = counts.get(d, 0) + 1
    return dict(sorted(counts.items()))


def _eddington_number(times_completed: dict[int, int]) -> int:
    eddington = 0
    for distance, count in times_completed.items():
        if count >= distance:
            eddington = distance
        else:
            break
    return eddington


def _eddington_history(distances_per_day: dict[date, float], number: int) -> dict[int, date]:
    """Find, for each d in 1..E, the date the athlete reached Eddington d."""
    # Iterate days oldest -> newest so the qualifying day is the achievement date.
    ordered_days = sorted(distances_per_day.items())
    history: dict[int, date] = {}
    for distance in range(number, 0, -1):
        qualifying = 0
        for day, distance_in_day in ordered_days:
            if distance_in_day >= distance:
                qualifying += 1
            if qualifying == distance:
                history[distance] = day
                break
    return dict(sorted(history.items()))


@lru_cache(maxsize=64)
def _compute_cached(distances_tuple: tuple, unit: str) -> EddingtonResult:
    distances_per_day = dict(distances_tuple)
    times_completed = _times_completed(distances_per_day)
    number = _eddington_number(times_completed)
    longest_day = int(max(distances_per_day.values()))

    days_to_next = {
        distance: distance - times_completed.get(distance, 0)
        for distance in range(number + 1, longest_day + 1)
    }
    history = _eddington_history(distances_per_day, number)

    return EddingtonResult(
        number=number,
        unit=unit,
        longest_day=longest_day,
        times_completed=times_completed,
        days_to_next=days_to_next,
        history=history,
    )


def compute_eddington(distances_per_day: dict[date, float], unit: str = "km") -> EddingtonResult:
    if not distances_per_day:
        return EddingtonResult(unit=unit)
    # The sorted-items tuple fully identifies the input, so it alone is a correct
    # lru_cache key - no separate digest needed.
    as_tuple = tuple(sorted(distances_per_day.items()))
    return _compute_cached(as_tuple, unit)

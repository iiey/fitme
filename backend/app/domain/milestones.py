from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from enum import Enum

from app.domain.best_efforts import DISTANCE_LABELS
from app.domain.units import (
    distance_for_unit,
    distance_unit_label,
    elevation_for_unit,
    elevation_unit_label,
    format_duration,
)
from app.enums import SportType
from app.models import Activity, BestEffort

# Threshold ladders. Distances are expressed in the athlete's distance unit.
CUMULATIVE_DISTANCE_THRESHOLDS = [100, 250, 500, 1000, 2500, 5000, 10000, 25000, 50000]
CUMULATIVE_ELEVATION_THRESHOLDS = [1000, 5000, 10000, 25000, 50000, 100000, 250000]
CUMULATIVE_TIME_THRESHOLDS_H = [10, 50, 100, 250, 500, 1000, 2500]
ACTIVITY_COUNT_THRESHOLDS = [1, 10, 50, 100, 250, 500, 1000, 2500]
STREAK_THRESHOLDS = [7, 14, 30, 60, 100, 182, 365]

# Approximate real-world references for "fun comparison" flavour text.
_DISTANCE_REFERENCES_KM = [
    (42.195, "a marathon"),
    (100, "the length of a century ride"),
    (343, "the distance Paris to Brussels"),
    (1300, "the length of Italy"),
    (4000, "the width of the United States"),
    (40075, "a full lap around the Earth"),
]
_ELEVATION_REFERENCES_M = [
    (828, "the Burj Khalifa"),
    (4809, "Mont Blanc"),
    (8849, "Mount Everest"),
    (100000, "the edge of space, 100x over"),
]


class MilestoneGroup(str, Enum):
    FIRSTS = "Firsts"
    DISTANCE = "Distance"
    ELEVATION = "Elevation"
    TIME = "Time"
    COUNT = "Count"
    PERSONAL_BESTS = "Personal Bests"
    EDDINGTON = "Eddington"
    STREAKS = "Streaks"


@dataclass
class Milestone:
    achieved_on: date
    group: MilestoneGroup
    title: str
    description: str
    icon: str
    sport_type: str | None = None
    activity_id: str | None = None
    fun_comparison: str | None = None

    def as_dict(self) -> dict:
        return {
            "achieved_on": self.achieved_on.isoformat(),
            "group": self.group.value,
            "title": self.title,
            "description": self.description,
            "icon": self.icon,
            "sport_type": self.sport_type,
            "activity_id": self.activity_id,
            "fun_comparison": self.fun_comparison,
        }


def _distance_fun_comparison(total_km: float) -> str | None:
    best: str | None = None
    for reference_km, label in _DISTANCE_REFERENCES_KM:
        if total_km >= reference_km:
            multiple = total_km / reference_km
            best = f"That's {multiple:.1f}x {label}." if multiple >= 1.5 else f"That's {label}."
    return best


def _elevation_fun_comparison(total_m: float) -> str | None:
    best: str | None = None
    for reference_m, label in _ELEVATION_REFERENCES_M:
        if total_m >= reference_m:
            multiple = total_m / reference_m
            best = f"That's {multiple:.1f}x {label}." if multiple >= 1.5 else f"That's {label}."
    return best


def _first_activity_milestones(activities: list[Activity]) -> list[Milestone]:
    seen: set[str] = set()
    milestones: list[Milestone] = []
    for activity in activities:
        if activity.sport_type in seen:
            continue
        seen.add(activity.sport_type)
        sport = SportType.from_strava(activity.sport_type)
        milestones.append(
            Milestone(
                achieved_on=activity.start_date_time.date(),
                group=MilestoneGroup.FIRSTS,
                title=f"First {sport.label}",
                description=f"Your very first {sport.label} activity: {activity.name}.",
                icon="flag",
                sport_type=activity.sport_type,
                activity_id=activity.activity_id,
            )
        )
    return milestones


def _cumulative_distance_milestones(
    activities: list[Activity], unit_system: str
) -> list[Milestone]:
    unit = distance_unit_label(unit_system)
    by_type: dict[str, float] = {}
    crossed: set[tuple[str, int]] = set()
    milestones: list[Milestone] = []

    for activity in activities:
        sport = SportType.from_strava(activity.sport_type)
        if not sport.is_distance_based:
            continue
        running = by_type.get(activity.activity_type, 0.0)
        running += distance_for_unit(activity.distance_m, unit_system)
        by_type[activity.activity_type] = running
        for threshold in CUMULATIVE_DISTANCE_THRESHOLDS:
            key = (activity.activity_type, threshold)
            if running >= threshold and key not in crossed:
                crossed.add(key)
                total_km = running if unit_system == "metric" else running * 1.609344
                milestones.append(
                    Milestone(
                        achieved_on=activity.start_date_time.date(),
                        group=MilestoneGroup.DISTANCE,
                        title=f"{threshold:,} {unit} of {activity.activity_type}",
                        description=f"Reached {threshold:,} {unit} cumulative {activity.activity_type} distance.",
                        icon="route",
                        activity_id=activity.activity_id,
                        fun_comparison=_distance_fun_comparison(total_km),
                    )
                )
    return milestones


def _cumulative_elevation_milestones(
    activities: list[Activity], unit_system: str
) -> list[Milestone]:
    unit = elevation_unit_label(unit_system)
    running = 0.0
    running_metres = 0.0
    crossed: set[int] = set()
    milestones: list[Milestone] = []
    for activity in activities:
        running += elevation_for_unit(activity.elevation_m or 0.0, unit_system)
        running_metres += activity.elevation_m or 0.0
        for threshold in CUMULATIVE_ELEVATION_THRESHOLDS:
            if running >= threshold and threshold not in crossed:
                crossed.add(threshold)
                milestones.append(
                    Milestone(
                        achieved_on=activity.start_date_time.date(),
                        group=MilestoneGroup.ELEVATION,
                        title=f"{threshold:,} {unit} climbed",
                        description=f"Total elevation gain passed {threshold:,} {unit}.",
                        icon="mountain",
                        activity_id=activity.activity_id,
                        fun_comparison=_elevation_fun_comparison(running_metres),
                    )
                )
    return milestones


def _cumulative_time_milestones(activities: list[Activity]) -> list[Milestone]:
    running_seconds = 0
    crossed: set[int] = set()
    milestones: list[Milestone] = []
    for activity in activities:
        running_seconds += activity.moving_time_s or 0
        running_hours = running_seconds / 3600
        for threshold in CUMULATIVE_TIME_THRESHOLDS_H:
            if running_hours >= threshold and threshold not in crossed:
                crossed.add(threshold)
                milestones.append(
                    Milestone(
                        achieved_on=activity.start_date_time.date(),
                        group=MilestoneGroup.TIME,
                        title=f"{threshold:,} hours in motion",
                        description=f"Spent over {threshold:,} hours moving across all activities.",
                        icon="clock",
                        activity_id=activity.activity_id,
                    )
                )
    return milestones


def _activity_count_milestones(activities: list[Activity]) -> list[Milestone]:
    crossed: set[int] = set()
    milestones: list[Milestone] = []
    for index, activity in enumerate(activities, start=1):
        for threshold in ACTIVITY_COUNT_THRESHOLDS:
            if index == threshold and threshold not in crossed:
                crossed.add(threshold)
                label = "activity" if threshold == 1 else "activities"
                milestones.append(
                    Milestone(
                        achieved_on=activity.start_date_time.date(),
                        group=MilestoneGroup.COUNT,
                        title=f"{threshold:,} {label}",
                        description=f"Logged {threshold:,} {label} in total.",
                        icon="hashtag",
                        activity_id=activity.activity_id,
                    )
                )
    return milestones


def _personal_best_milestones(best_efforts: list[BestEffort]) -> list[Milestone]:
    """Emit a milestone each time a best-effort record over a distance improved."""
    by_distance: dict[int, list[BestEffort]] = {}
    for effort in best_efforts:
        by_distance.setdefault(effort.distance_m, []).append(effort)

    milestones: list[Milestone] = []
    for distance_m, efforts in by_distance.items():
        efforts.sort(key=lambda e: e.start_date_time)
        record: float | None = None
        for effort in efforts:
            if record is None or effort.time_s < record:
                record = effort.time_s
                label = DISTANCE_LABELS.get(distance_m, f"{distance_m} m")
                milestones.append(
                    Milestone(
                        achieved_on=effort.start_date_time.date(),
                        group=MilestoneGroup.PERSONAL_BESTS,
                        title=f"New {label} PR: {format_duration(effort.time_s)}",
                        description=f"Set a new personal best over {label}.",
                        icon="stopwatch",
                        sport_type=effort.sport_type,
                        activity_id=effort.activity_id,
                    )
                )
    return milestones


def discover_milestones(
    activities: list[Activity],
    best_efforts: list[BestEffort],
    unit_system: str,
) -> list[Milestone]:
    """Run all discoverers and return milestones sorted newest-first."""
    ordered = sorted(activities, key=lambda a: a.start_date_time)
    milestones: list[Milestone] = []
    milestones += _first_activity_milestones(ordered)
    milestones += _cumulative_distance_milestones(ordered, unit_system)
    milestones += _cumulative_elevation_milestones(ordered, unit_system)
    milestones += _cumulative_time_milestones(ordered)
    milestones += _activity_count_milestones(ordered)
    milestones += _personal_best_milestones(best_efforts)
    milestones.sort(key=lambda m: m.achieved_on, reverse=True)
    return milestones

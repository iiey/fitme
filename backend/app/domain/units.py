from __future__ import annotations

KM_PER_MILE = 1.609344
M_PER_MILE = 1609.344
M_PER_FOOT = 0.3048


def m_to_km(metres: float) -> float:
    return metres / 1000.0


def m_to_mi(metres: float) -> float:
    return metres / M_PER_MILE


def distance_for_unit(metres: float, unit_system: str) -> float:
    return m_to_mi(metres) if unit_system == "imperial" else m_to_km(metres)


def elevation_for_unit(metres: float, unit_system: str) -> float:
    return metres / M_PER_FOOT if unit_system == "imperial" else metres


def distance_unit_label(unit_system: str) -> str:
    return "mi" if unit_system == "imperial" else "km"


def elevation_unit_label(unit_system: str) -> str:
    return "ft" if unit_system == "imperial" else "m"


def ms_to_kmh(ms: float) -> float:
    return ms * 3.6


def format_duration(seconds: float | int | None) -> str:
    """Format a duration as ``H:MM:SS`` (or ``M:SS`` when under an hour)."""
    if seconds is None:
        return "-"
    seconds = int(round(seconds))
    hours, rem = divmod(seconds, 3600)
    minutes, secs = divmod(rem, 60)
    if hours:
        return f"{hours}:{minutes:02d}:{secs:02d}"
    return f"{minutes}:{secs:02d}"


def format_pace(seconds_per_unit: float | None) -> str:
    """Format a pace value (seconds per km/mi/100m) as ``M:SS``."""
    if not seconds_per_unit or seconds_per_unit <= 0:
        return "-"
    seconds = int(round(seconds_per_unit))
    minutes, secs = divmod(seconds, 60)
    return f"{minutes}:{secs:02d}"

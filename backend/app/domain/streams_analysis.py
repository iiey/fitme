from __future__ import annotations

from app.enums import StreamType

# Durations (seconds) for the peak-power-output widget.
PEAK_POWER_DURATIONS = [5, 30, 60, 300, 1200]


def peak_power_for_duration(time_s: list[int], watts: list[float], duration: int) -> float | None:
    """Maximum average power sustained over any window of >= ``duration`` seconds."""
    n = min(len(time_s), len(watts))
    if n == 0:
        return None

    prefix = [0.0] * (n + 1)
    for i in range(n):
        prefix[i + 1] = prefix[i] + (watts[i] or 0.0)

    best: float | None = None
    start = 0
    for end in range(n):
        while time_s[end] - time_s[start] > duration and start < end:
            start += 1
        if time_s[end] - time_s[start] >= duration * 0.9:
            samples = end - start + 1
            if samples > 0:
                avg = (prefix[end + 1] - prefix[start]) / samples
                if best is None or avg > best:
                    best = avg
    return best


def peak_power_outputs(streams: dict[str, list]) -> dict[int, float]:
    time_s = streams.get(StreamType.TIME.value) or []
    watts = streams.get(StreamType.WATTS.value) or []
    if not time_s or not watts:
        return {}
    outputs: dict[int, float] = {}
    for duration in PEAK_POWER_DURATIONS:
        peak = peak_power_for_duration(time_s, watts, duration)
        if peak is not None:
            outputs[duration] = round(peak)
    return outputs


def time_in_hr_zones(streams: dict[str, list], zone_lower_bounds: list[int]) -> list[int]:
    """Seconds spent in each of the 5 heart-rate zones for one activity."""
    time_s = streams.get(StreamType.TIME.value) or []
    heart_rate = streams.get(StreamType.HEART_RATE.value) or []
    zones = [0] * 5
    if not time_s or not heart_rate:
        return zones

    n = min(len(time_s), len(heart_rate))
    for i in range(1, n):
        hr = heart_rate[i]
        if hr is None:
            continue
        delta = max(0, time_s[i] - time_s[i - 1])
        zones[_zone_index(hr, zone_lower_bounds)] += delta
    return zones


def _zone_index(hr: float, zone_lower_bounds: list[int]) -> int:
    """Map a heart-rate value to a 0-based zone index (5 zones)."""
    # zone_lower_bounds holds the lower bounds of zones 1..5 (length 5).
    zone = 0
    for index, lower in enumerate(zone_lower_bounds):
        if hr >= lower:
            zone = index
    return min(zone, 4)

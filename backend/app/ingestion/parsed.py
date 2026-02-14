from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime

from app.domain.math_utils import haversine_distance, safe_avg
from app.enums import StreamType


@dataclass
class ParsedActivityFile:
    """Raw streams + metadata extracted from a single GPX/TCX/FIT file."""

    streams: dict[str, list] = field(default_factory=dict)
    start_time: datetime | None = None
    # Wall-clock start time in the athlete's local timezone, when the source
    # file carries timezone information (FIT ``local_timestamp``). Falls back to
    # ``None`` for formats that only record UTC (GPX/TCX).
    start_time_local: datetime | None = None
    sport_type: str | None = None
    device_name: str | None = None
    calories: int | None = None

    def latlng(self) -> list[list[float]]:
        return [p for p in self.streams.get(StreamType.LAT_LNG.value, []) if p]

    def has_gps(self) -> bool:
        return any(p for p in self.streams.get(StreamType.LAT_LNG.value, []))


@dataclass
class StreamSummary:
    """Aggregated numbers derived from a parsed file's streams."""

    distance_m: float | None = None
    elevation_gain_m: float | None = None
    moving_time_s: int | None = None
    elapsed_time_s: int | None = None
    average_speed_ms: float | None = None
    max_speed_ms: float | None = None
    average_heart_rate: int | None = None
    max_heart_rate: int | None = None
    average_cadence: int | None = None
    max_cadence: int | None = None
    average_power: int | None = None
    max_power: int | None = None
    normalized_power: float | None = None
    start_latitude: float | None = None
    start_longitude: float | None = None


def summarize_streams(parsed: ParsedActivityFile) -> StreamSummary:
    """Compute summary metrics from a parsed file (used to fill CSV gaps)."""
    streams = parsed.streams
    summary = StreamSummary()

    distances = streams.get(StreamType.DISTANCE.value) or []
    if distances:
        summary.distance_m = float(distances[-1])

    times = streams.get(StreamType.TIME.value) or []
    if times:
        summary.elapsed_time_s = int(times[-1])

    moving = streams.get(StreamType.MOVING.value) or []
    if moving and times:
        moving_seconds = 0
        for i in range(1, len(times)):
            if moving[i]:
                moving_seconds += max(0, int(times[i]) - int(times[i - 1]))
        summary.moving_time_s = moving_seconds
    elif times:
        summary.moving_time_s = int(times[-1])

    speeds = [v for v in (streams.get(StreamType.VELOCITY.value) or []) if v is not None]
    if speeds:
        summary.average_speed_ms = safe_avg(speeds)
        summary.max_speed_ms = max(speeds)
    elif summary.distance_m and summary.moving_time_s:
        summary.average_speed_ms = summary.distance_m / summary.moving_time_s

    hr = [v for v in (streams.get(StreamType.HEART_RATE.value) or []) if v]
    if hr:
        summary.average_heart_rate = round(sum(hr) / len(hr))
        summary.max_heart_rate = int(max(hr))

    cadence = [v for v in (streams.get(StreamType.CADENCE.value) or []) if v]
    if cadence:
        summary.average_cadence = round(sum(cadence) / len(cadence))
        summary.max_cadence = int(max(cadence))

    watts = [v for v in (streams.get(StreamType.WATTS.value) or []) if v is not None]
    if watts:
        summary.average_power = round(sum(watts) / len(watts))
        summary.max_power = max(int(w) for w in watts)
        summary.normalized_power = _normalized_power(watts)

    altitudes = [v for v in (streams.get(StreamType.ALTITUDE.value) or []) if v is not None]
    if altitudes:
        summary.elevation_gain_m = _elevation_gain(altitudes)

    coords = parsed.latlng()
    if coords:
        summary.start_latitude = coords[0][0]
        summary.start_longitude = coords[0][1]

    return summary


def _smooth(values: list[float], window: int) -> list[float]:
    """Centered moving average to damp barometric/GPS altitude noise."""
    if window <= 1 or len(values) <= window:
        return values
    half = window // 2
    smoothed: list[float] = []
    for i in range(len(values)):
        chunk = values[max(0, i - half) : min(len(values), i + half + 1)]
        smoothed.append(sum(chunk) / len(chunk))
    return smoothed


def _elevation_gain(
    altitudes: list[float], threshold: float = 2.0, smooth_window: int = 15
) -> float:
    """Total ascent: sum of positive altitude deltas after de-noising.

    Raw barometric/GPS altitude is noisy, and naively summing every up-tick
    inflates total ascent by an order of magnitude (a flat run can read ~2 km).
    A centered moving average removes the high-frequency jitter first, then a
    threshold adds hysteresis so only sustained climbs accumulate.
    """
    if not altitudes:
        return 0.0
    series = _smooth(altitudes, smooth_window)
    gain = 0.0
    last = series[0]
    for value in series[1:]:
        delta = value - last
        if delta >= threshold:
            gain += delta
            last = value
        elif delta < 0:
            last = value
    return gain


def _normalized_power(watts: list[float]) -> float | None:
    """30-second rolling-average, 4th-power normalized power (Coggan)."""
    if len(watts) < 30:
        avg = safe_avg(watts)
        return avg
    rolling: list[float] = []
    window: list[float] = []
    running = 0.0
    for w in watts:
        window.append(w)
        running += w
        if len(window) > 30:
            running -= window.pop(0)
        if len(window) == 30:
            rolling.append(running / 30.0)
    if not rolling:
        return safe_avg(watts)
    fourth = sum(p**4 for p in rolling) / len(rolling)
    return fourth**0.25


def _haversine_series(coords: list[list[float] | None]) -> list[float]:
    """Cumulative haversine distance for a coordinate stream."""
    cumulative = 0.0
    out: list[float] = []
    prev: list[float] | None = None
    for point in coords:
        if point and prev:
            cumulative += haversine_distance(prev[0], prev[1], point[0], point[1])
        out.append(round(cumulative, 2))
        if point:
            prev = point
    return out

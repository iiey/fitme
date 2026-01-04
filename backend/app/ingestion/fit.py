from __future__ import annotations

import io
from datetime import datetime

from app.enums import StreamType
from app.ingestion.parsed import ParsedActivityFile

_SEMICIRCLE_TO_DEG = 180.0 / 2**31

_FIT_SPORT_MAP = {
    "cycling": "Ride",
    "mountain_biking": "MountainBikeRide",
    "gravel_cycling": "GravelRide",
    "e_biking": "EBikeRide",
    "running": "Run",
    "trail_running": "TrailRun",
    "walking": "Walk",
    "hiking": "Hike",
    "swimming": "Swim",
    "rowing": "Rowing",
    "alpine_skiing": "AlpineSki",
    "cross_country_skiing": "NordicSki",
    "snowboarding": "Snowboard",
    "inline_skating": "InlineSkate",
    "training": "Workout",
}


def _semicircles_to_degrees(value) -> float | None:
    if value is None:
        return None
    return value * _SEMICIRCLE_TO_DEG


def _get(frame, *names):
    for name in names:
        try:
            value = frame.get_value(name)
        except KeyError:
            continue
        if value is not None:
            return value
    return None


def parse_fit(content: bytes) -> ParsedActivityFile:
    import fitdecode

    streams: dict[str, list] = {
        StreamType.TIME.value: [],
        StreamType.DISTANCE.value: [],
        StreamType.LAT_LNG.value: [],
        StreamType.ALTITUDE.value: [],
        StreamType.VELOCITY.value: [],
        StreamType.HEART_RATE.value: [],
        StreamType.CADENCE.value: [],
        StreamType.WATTS.value: [],
        StreamType.TEMP.value: [],
        StreamType.MOVING.value: [],
    }

    start_ts: float | None = None
    sport_type: str | None = None
    device_name: str | None = None
    calories: int | None = None

    with fitdecode.FitReader(io.BytesIO(content)) as reader:
        for frame in reader:
            if not isinstance(frame, fitdecode.FitDataMessage):
                continue
            if frame.name == "sport":
                sport = _get(frame, "sport")
                if sport:
                    sport_type = _FIT_SPORT_MAP.get(str(sport).lower(), sport_type)
            elif frame.name == "session":
                sport = _get(frame, "sport")
                if sport:
                    sport_type = _FIT_SPORT_MAP.get(str(sport).lower(), sport_type)
                cal = _get(frame, "total_calories")
                if cal is not None:
                    calories = int(cal)
            elif frame.name == "device_info" and device_name is None:
                manufacturer = _get(frame, "manufacturer")
                product = _get(frame, "garmin_product", "product_name", "product")
                if manufacturer or product:
                    device_name = " ".join(str(p) for p in (manufacturer, product) if p)
            elif frame.name == "record":
                timestamp = _get(frame, "timestamp")
                if timestamp is None:
                    continue
                ts = timestamp.timestamp() if isinstance(timestamp, datetime) else float(timestamp)
                if start_ts is None:
                    start_ts = ts

                lat = _semicircles_to_degrees(_get(frame, "position_lat"))
                lon = _semicircles_to_degrees(_get(frame, "position_long"))
                altitude = _get(frame, "enhanced_altitude", "altitude")
                distance = _get(frame, "distance")
                speed = _get(frame, "enhanced_speed", "speed")
                hr = _get(frame, "heart_rate")
                cadence = _get(frame, "cadence")
                power = _get(frame, "power")
                temp = _get(frame, "temperature")

                streams[StreamType.TIME.value].append(int(ts - start_ts))
                streams[StreamType.DISTANCE.value].append(
                    round(float(distance), 2) if distance is not None else None
                )
                streams[StreamType.LAT_LNG.value].append(
                    [lat, lon] if lat is not None and lon is not None else None
                )
                streams[StreamType.ALTITUDE.value].append(
                    float(altitude) if altitude is not None else None
                )
                streams[StreamType.VELOCITY.value].append(
                    float(speed) if speed is not None else None
                )
                streams[StreamType.HEART_RATE.value].append(int(hr) if hr is not None else None)
                streams[StreamType.CADENCE.value].append(
                    int(cadence) if cadence is not None else None
                )
                streams[StreamType.WATTS.value].append(float(power) if power is not None else None)
                streams[StreamType.TEMP.value].append(float(temp) if temp is not None else None)
                speed_val = float(speed) if speed is not None else None
                streams[StreamType.MOVING.value].append(speed_val is None or speed_val > 0.5)

    if start_ts is None:
        raise ValueError("No record messages with timestamps in FIT file")

    # Backfill cumulative distance when the device did not record a distance field.
    if all(d is None for d in streams[StreamType.DISTANCE.value]):
        from app.ingestion.parsed import _haversine_series

        streams[StreamType.DISTANCE.value] = _haversine_series(streams[StreamType.LAT_LNG.value])

    from app.ingestion.gpx import _prune_empty

    return ParsedActivityFile(
        streams=_prune_empty(streams),
        start_time=datetime.fromtimestamp(start_ts),
        sport_type=sport_type,
        device_name=device_name,
        calories=calories,
    )

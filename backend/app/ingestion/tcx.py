from __future__ import annotations

import re
import xml.etree.ElementTree as ET
from datetime import datetime

from app.domain.math_utils import haversine_distance
from app.enums import StreamType
from app.ingestion.gpx import _parse_time
from app.ingestion.parsed import ParsedActivityFile

_NS_RE = re.compile(r"\sxmlns(:\w+)?=\"[^\"]*\"")
_PREFIX_RE = re.compile(r"(</?)\w+:")

_TCX_SPORT_MAP = {
    "biking": "Ride",
    "running": "Run",
    "walking": "Walk",
    "hiking": "Hike",
    "swimming": "Swim",
    "other": "Workout",
}


def _strip_namespaces(xml_text: str) -> str:
    xml_text = _NS_RE.sub("", xml_text)
    xml_text = _PREFIX_RE.sub(r"\1", xml_text)
    return xml_text


def _float(el: ET.Element | None) -> float | None:
    if el is None or not el.text:
        return None
    try:
        return float(el.text)
    except ValueError:
        return None


def parse_tcx(content: bytes | str) -> ParsedActivityFile:
    text = content.decode("utf-8", errors="ignore") if isinstance(content, bytes) else content
    if not text.strip():
        raise ValueError("Empty TCX file")
    text = _strip_namespaces(text)
    root = ET.fromstring(text)

    activity_el = root.find(".//Activity")
    sport_type = None
    if activity_el is not None:
        sport_attr = (activity_el.get("Sport") or "").strip().lower()
        sport_type = _TCX_SPORT_MAP.get(sport_attr)

    creator = root.find(".//Creator/Name")
    device_name = creator.text.strip() if creator is not None and creator.text else None

    streams: dict[str, list] = {
        StreamType.TIME.value: [],
        StreamType.DISTANCE.value: [],
        StreamType.LAT_LNG.value: [],
        StreamType.ALTITUDE.value: [],
        StreamType.VELOCITY.value: [],
        StreamType.HEART_RATE.value: [],
        StreamType.CADENCE.value: [],
        StreamType.WATTS.value: [],
        StreamType.MOVING.value: [],
    }

    start_ts: float | None = None
    cumulative = 0.0
    calories = 0
    prev_lat = prev_lon = prev_time = prev_dist = None

    for lap in root.findall(".//Lap"):
        cal_el = lap.find("Calories")
        if cal_el is not None and cal_el.text:
            try:
                calories += int(float(cal_el.text))
            except ValueError:
                pass
        for tp in lap.findall(".//Trackpoint"):
            time_el = tp.find("Time")
            if time_el is None or not time_el.text:
                continue
            point_time = _parse_time(time_el.text)
            if point_time is None:
                continue
            ts = point_time.timestamp()
            if start_ts is None:
                start_ts = ts

            lat = _float(tp.find("Position/LatitudeDegrees"))
            lon = _float(tp.find("Position/LongitudeDegrees"))
            altitude = _float(tp.find("AltitudeMeters"))
            distance = _float(tp.find("DistanceMeters"))
            hr = _float(tp.find("HeartRateBpm/Value"))
            cadence = _float(tp.find("Cadence"))
            watts = _float(tp.find(".//Watts"))
            speed = _float(tp.find(".//Speed"))

            if distance is not None:
                cumulative = distance
            elif None not in (prev_lat, prev_lon, lat, lon):
                cumulative += haversine_distance(prev_lat, prev_lon, lat, lon)

            if speed is None and prev_time is not None and ts > prev_time and prev_dist is not None:
                speed = max(0.0, (cumulative - prev_dist) / (ts - prev_time))

            streams[StreamType.TIME.value].append(int(ts - start_ts))
            streams[StreamType.DISTANCE.value].append(round(cumulative, 2))
            streams[StreamType.LAT_LNG.value].append([lat, lon] if lat is not None else None)
            streams[StreamType.ALTITUDE.value].append(altitude)
            streams[StreamType.VELOCITY.value].append(speed)
            streams[StreamType.HEART_RATE.value].append(int(hr) if hr is not None else None)
            streams[StreamType.CADENCE.value].append(int(cadence) if cadence is not None else None)
            streams[StreamType.WATTS.value].append(watts)
            streams[StreamType.MOVING.value].append(speed is None or speed > 0.5)

            prev_lat, prev_lon, prev_time, prev_dist = lat, lon, ts, cumulative

    if start_ts is None:
        raise ValueError("No timestamped trackpoints in TCX")

    from app.ingestion.gpx import _prune_empty

    return ParsedActivityFile(
        streams=_prune_empty(streams),
        start_time=datetime.fromtimestamp(start_ts),
        sport_type=sport_type,
        device_name=device_name,
        calories=calories or None,
    )

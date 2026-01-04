from __future__ import annotations

import re
import xml.etree.ElementTree as ET
from datetime import datetime

from app.domain.math_utils import haversine_distance
from app.enums import StreamType
from app.ingestion.parsed import ParsedActivityFile

_NS_RE = re.compile(r"\sxmlns(:\w+)?=\"[^\"]*\"")
_PREFIX_RE = re.compile(r"(</?)\w+:")

# Map GPX <type> values to Strava sport types.
_GPX_TYPE_MAP = {
    "1": "Ride",
    "9": "Run",
    "cycling": "Ride",
    "running": "Run",
    "hiking": "Hike",
    "walking": "Walk",
    "mountain biking": "MountainBikeRide",
    "road cycling": "Ride",
    "trail running": "TrailRun",
}


def _strip_namespaces(xml_text: str) -> str:
    xml_text = _NS_RE.sub("", xml_text)
    xml_text = _PREFIX_RE.sub(r"\1", xml_text)
    return xml_text


def _parse_time(value: str) -> datetime | None:
    value = value.strip()
    if not value:
        return None
    try:
        # Normalise trailing Z to an explicit UTC offset for fromisoformat.
        return datetime.fromisoformat(value.replace("Z", "+00:00")).replace(tzinfo=None)
    except ValueError:
        for fmt in ("%Y-%m-%dT%H:%M:%S.%f%z", "%Y-%m-%dT%H:%M:%S%z"):
            try:
                return datetime.strptime(value, fmt).replace(tzinfo=None)
            except ValueError:
                continue
    return None


def _extension_values(trkpt: ET.Element) -> dict[str, float | None]:
    out: dict[str, float | None] = {"hr": None, "cad": None, "power": None, "temp": None}
    for ext in trkpt.iter():
        tag = ext.tag.lower()
        text = (ext.text or "").strip()
        if not text:
            continue
        try:
            number = float(text)
        except ValueError:
            continue
        if tag in ("hr", "heartrate"):
            out["hr"] = number
        elif tag in ("cad", "cadence"):
            out["cad"] = number
        elif tag in ("power", "watts"):
            out["power"] = number
        elif tag in ("atemp", "temp", "temperature"):
            out["temp"] = number
    return out


def parse_gpx(content: bytes | str) -> ParsedActivityFile:
    text = content.decode("utf-8", errors="ignore") if isinstance(content, bytes) else content
    if not text.strip():
        raise ValueError("Empty GPX file")
    text = _strip_namespaces(text)
    root = ET.fromstring(text)

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
    cumulative = 0.0
    sport_type: str | None = None
    device_name = None

    trk = root.find("trk")
    if trk is None:
        raise ValueError("No <trk> element in GPX")

    type_el = trk.find("type")
    if type_el is not None and type_el.text:
        sport_type = _GPX_TYPE_MAP.get(type_el.text.strip().lower(), None)

    for segment in trk.findall("trkseg"):
        prev_lat = prev_lon = prev_time = None
        for trkpt in segment.findall("trkpt"):
            time_el = trkpt.find("time")
            if time_el is None or not time_el.text:
                continue
            point_time = _parse_time(time_el.text)
            if point_time is None:
                continue
            ts = point_time.timestamp()
            if start_ts is None:
                start_ts = ts

            lat = float(trkpt.get("lat")) if trkpt.get("lat") else None
            lon = float(trkpt.get("lon")) if trkpt.get("lon") else None
            ele_el = trkpt.find("ele")
            altitude = float(ele_el.text) if ele_el is not None and ele_el.text else None

            speed = None
            if None not in (prev_lat, prev_lon, lat, lon):
                delta = haversine_distance(prev_lat, prev_lon, lat, lon)
                cumulative += delta
                if prev_time is not None and ts > prev_time:
                    speed = delta / (ts - prev_time)

            ext = _extension_values(trkpt)

            streams[StreamType.TIME.value].append(int(ts - start_ts))
            streams[StreamType.DISTANCE.value].append(round(cumulative, 2))
            streams[StreamType.LAT_LNG.value].append([lat, lon] if lat is not None else None)
            streams[StreamType.ALTITUDE.value].append(altitude)
            streams[StreamType.VELOCITY.value].append(speed)
            streams[StreamType.HEART_RATE.value].append(ext["hr"])
            streams[StreamType.CADENCE.value].append(ext["cad"])
            streams[StreamType.WATTS.value].append(ext["power"])
            streams[StreamType.TEMP.value].append(ext["temp"])
            streams[StreamType.MOVING.value].append(speed is None or speed > 0.5)

            prev_lat, prev_lon, prev_time = lat, lon, ts

    if start_ts is None:
        raise ValueError("No timestamped trackpoints in GPX")

    return ParsedActivityFile(
        streams=_prune_empty(streams),
        start_time=datetime.fromtimestamp(start_ts),
        sport_type=sport_type,
        device_name=device_name,
    )


def _prune_empty(streams: dict[str, list]) -> dict[str, list]:
    """Drop streams that carry no real signal (all None)."""
    out = {}
    for key, values in streams.items():
        if key in (StreamType.TIME.value, StreamType.DISTANCE.value, StreamType.LAT_LNG.value):
            out[key] = values
        elif any(v is not None for v in values):
            out[key] = values
    return out

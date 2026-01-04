from __future__ import annotations


def encode(coordinates: list[list[float]]) -> str:
    """Encode a list of ``[lat, lng]`` pairs as a Google encoded polyline."""
    result: list[str] = []
    prev_lat = 0
    prev_lng = 0
    for lat, lng in coordinates:
        ilat = int(round(lat * 1e5))
        ilng = int(round(lng * 1e5))
        result.append(_encode_value(ilat - prev_lat))
        result.append(_encode_value(ilng - prev_lng))
        prev_lat = ilat
        prev_lng = ilng
    return "".join(result)


def decode(polyline: str) -> list[list[float]]:
    """Decode a Google encoded polyline into a list of ``[lat, lng]`` pairs."""
    coordinates: list[list[float]] = []
    index = 0
    lat = 0
    lng = 0
    length = len(polyline)
    while index < length:
        lat_delta, index = _decode_value(polyline, index)
        lng_delta, index = _decode_value(polyline, index)
        lat += lat_delta
        lng += lng_delta
        coordinates.append([lat / 1e5, lng / 1e5])
    return coordinates


def _encode_value(value: int) -> str:
    value = ~(value << 1) if value < 0 else (value << 1)
    chunks = []
    while value >= 0x20:
        chunks.append(chr((0x20 | (value & 0x1F)) + 63))
        value >>= 5
    chunks.append(chr(value + 63))
    return "".join(chunks)


def _decode_value(polyline: str, index: int) -> tuple[int, int]:
    result = 0
    shift = 0
    while True:
        byte = ord(polyline[index]) - 63
        index += 1
        result |= (byte & 0x1F) << shift
        shift += 5
        if byte < 0x20:
            break
    delta = ~(result >> 1) if (result & 1) else (result >> 1)
    return delta, index

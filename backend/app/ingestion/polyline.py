from __future__ import annotations

import math


def _perpendicular_distance(point: list[float], start: list[float], end: list[float]) -> float:
    if start[0] == end[0] and start[1] == end[1]:
        return math.hypot(point[0] - start[0], point[1] - start[1])
    dx = end[0] - start[0]
    dy = end[1] - start[1]
    return abs(dy * point[0] - dx * point[1] + end[0] * start[1] - end[1] * start[0]) / math.hypot(
        dx, dy
    )


def rdp_simplify(coords: list[list[float]], epsilon: float = 0.00005) -> list[list[float]]:
    """Ramer-Douglas-Peucker polyline simplification."""
    if len(coords) <= 2:
        return coords

    max_dist = 0.0
    max_index = 0
    for i in range(1, len(coords) - 1):
        d = _perpendicular_distance(coords[i], coords[0], coords[-1])
        if d > max_dist:
            max_dist = d
            max_index = i

    if max_dist > epsilon:
        left = rdp_simplify(coords[: max_index + 1], epsilon)
        right = rdp_simplify(coords[max_index:], epsilon)
        return left[:-1] + right
    return [coords[0], coords[-1]]


def simplify_to_limit(coords: list[list[float]], max_points: int) -> list[list[float]]:
    """Simplify coordinates to fit within max_points using iterative RDP."""
    if len(coords) <= max_points:
        return coords
    epsilon = 0.00005
    result = rdp_simplify(coords, epsilon)
    while len(result) > max_points and epsilon < 1.0:
        epsilon *= 2
        result = rdp_simplify(coords, epsilon)
    return result


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

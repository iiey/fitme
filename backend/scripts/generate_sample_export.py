"""Generate a synthetic Strava bulk export for development and testing.

Creates ``activities.csv`` plus per-activity GPX tracks under an output folder
that mirrors the structure of a real Strava export, so the importer and all
features can be exercised without real personal data.
"""

from __future__ import annotations

import argparse
import csv
import math
import random
from datetime import datetime, timedelta
from pathlib import Path

# Base location (Greenbow, Alabama) around which synthetic routes are drawn.
BASE_LAT = 31.8279
BASE_LON = -86.6177
METRES_PER_DEG_LAT = 111_320.0

SPORTS = [
    # (strava_type, gear, min_km, max_km, base_speed_ms, has_power)
    ("Run", "Trail Shoes", 5, 18, 3.1, False),
    ("Ride", "Road Bike", 20, 90, 7.5, True),
    ("Run", "Road Shoes", 4, 12, 3.2, False),
    ("Ride", "Gravel Bike", 25, 70, 6.8, True),
    ("Walk", "Hiking Boots", 3, 10, 1.4, False),
]


def _mets_per_deg_lon(lat: float) -> float:
    return METRES_PER_DEG_LAT * math.cos(math.radians(lat))


def _gpx_track(
    start: datetime,
    distance_m: float,
    speed_ms: float,
    has_power: bool,
    sport: str,
) -> tuple[str, float]:
    """Build a GPX document for an out-and-back route. Returns (xml, elevation_gain)."""
    num_points = max(20, int(distance_m / 100))
    step_m = distance_m / num_points
    heading = random.uniform(0, 2 * math.pi)

    lat = BASE_LAT + random.uniform(-0.05, 0.05)
    lon = BASE_LON + random.uniform(-0.05, 0.05)
    elevation = random.uniform(20, 120)
    elevation_gain = 0.0

    points: list[str] = []
    current_time = start
    dt = step_m / speed_ms
    for i in range(num_points):
        if i == num_points // 2:
            heading += math.pi  # turn around for the return leg
        d_lat = (step_m * math.cos(heading)) / METRES_PER_DEG_LAT
        d_lon = (step_m * math.sin(heading)) / _mets_per_deg_lon(lat)
        lat += d_lat
        lon += d_lon
        delta_ele = random.uniform(-3, 3.5)
        if delta_ele > 0:
            elevation_gain += delta_ele
        elevation = max(0.0, elevation + delta_ele)
        current_time += timedelta(seconds=dt)

        hr = int(random.gauss(150 if sport == "Run" else 135, 10))
        extras = f"<gpxtpx:hr>{hr}</gpxtpx:hr>"
        if has_power:
            power = int(random.gauss(210, 40))
            extras += f"<gpxtpx:power>{power}</gpxtpx:power>"
        points.append(
            f'<trkpt lat="{lat:.6f}" lon="{lon:.6f}">'
            f"<ele>{elevation:.1f}</ele>"
            f"<time>{current_time.strftime('%Y-%m-%dT%H:%M:%SZ')}</time>"
            f"<extensions><gpxtpx:TrackPointExtension>{extras}"
            f"</gpxtpx:TrackPointExtension></extensions></trkpt>"
        )

    gpx_type = {"Run": "running", "Ride": "cycling", "Walk": "walking"}.get(sport, "running")
    xml = (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<gpx version="1.1" creator="FitMe sample generator" '
        'xmlns="http://www.topografix.com/GPX/1/1" '
        'xmlns:gpxtpx="http://www.garmin.com/xmlschemas/TrackPointExtension/v1">\n'
        f"<trk><type>{gpx_type}</type><trkseg>\n" + "\n".join(points) + "\n</trkseg></trk></gpx>\n"
    )
    return xml, elevation_gain


def generate(output: Path, count: int, years: int, seed: int) -> None:
    random.seed(seed)
    activities_dir = output / "activities"
    activities_dir.mkdir(parents=True, exist_ok=True)

    header = [
        "Activity ID",
        "Activity Date",
        "Activity Name",
        "Activity Type",
        "Activity Description",
        "Elapsed Time",
        "Moving Time",
        "Distance",
        "Max Heart Rate",
        "Average Heart Rate",
        "Average Watts",
        "Max Watts",
        "Calories",
        "Elevation Gain",
        "Average Speed",
        "Max Speed",
        "Commute",
        "Activity Gear",
        "Filename",
    ]
    rows: list[list] = []

    end = datetime(2025, 12, 20, 8, 0, 0)
    start_window = end - timedelta(days=365 * years)
    total_seconds = int((end - start_window).total_seconds())

    for index in range(count):
        sport, gear, min_km, max_km, base_speed, has_power = random.choice(SPORTS)
        when = start_window + timedelta(seconds=random.randint(0, total_seconds))
        when = when.replace(hour=random.randint(6, 19), minute=random.randint(0, 59))

        distance_m = random.uniform(min_km, max_km) * 1000
        speed = max(0.8, random.gauss(base_speed, base_speed * 0.12))
        moving_s = int(distance_m / speed)
        elapsed_s = int(moving_s * random.uniform(1.0, 1.15))

        activity_id = 10_000_000 + index
        filename = f"activities/{activity_id}.gpx"
        xml, elevation_gain = _gpx_track(when, distance_m, speed, has_power, sport)
        (output / filename).write_text(xml, encoding="utf-8")

        avg_hr = int(random.gauss(150 if sport == "Run" else 135, 6))
        rows.append(
            [
                activity_id,
                when.strftime("%b %d, %Y, %I:%M:%S %p"),
                f"{sport} {when.strftime('%b %d')}",
                sport,
                "",
                elapsed_s,
                moving_s,
                round(distance_m, 1),
                avg_hr + random.randint(8, 20),
                avg_hr,
                int(random.gauss(210, 30)) if has_power else "",
                int(random.gauss(420, 60)) if has_power else "",
                int(distance_m / 1000 * random.uniform(45, 65)),
                round(elevation_gain, 1),
                round(speed, 2),
                round(speed * random.uniform(1.3, 1.8), 2),
                "false",
                gear,
                filename,
            ]
        )

    rows.sort(key=lambda row: row[0])
    with (output / "activities.csv").open("w", newline="", encoding="utf-8") as fh:
        writer = csv.writer(fh)
        writer.writerow(header)
        writer.writerows(rows)

    _write_profile(output)

    print(f"Generated {count} activities under {output}")


def _write_profile(output: Path) -> None:
    """Write a synthetic ``profile.csv`` matching the Strava export layout."""
    header = [
        "Athlete ID",
        "First Name",
        "Last Name",
        "Sex",
        "City",
        "State",
        "Country",
    ]
    row = ["12345678", "Forrest", "Gump", "M", "Greenbow", "Alabama", "United States"]
    with (output / "profile.csv").open("w", newline="", encoding="utf-8") as fh:
        writer = csv.writer(fh)
        writer.writerow(header)
        writer.writerow(row)


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate a synthetic Strava export")
    parser.add_argument(
        "--output",
        type=Path,
        default=Path(__file__).resolve().parents[2] / "sample-data" / "strava-export",
    )
    parser.add_argument("--count", type=int, default=160)
    parser.add_argument("--years", type=int, default=3)
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()
    generate(args.output, args.count, args.years, args.seed)


if __name__ == "__main__":
    main()

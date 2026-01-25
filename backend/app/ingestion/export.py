from __future__ import annotations

import csv
import gzip
import io
import zipfile
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path

# Candidate header names (Strava varies these across export versions / locales).
# activities.csv contains duplicate headers: a formatted block first, then a raw
# numeric block. We keep the LAST occurrence (raw metres / seconds) for numerics.
_DATE_FORMATS = (
    "%b %d, %Y, %I:%M:%S %p",
    "%b %d, %Y, %H:%M:%S",
    "%d %b %Y, %H:%M:%S",
    "%Y-%m-%d %H:%M:%S",
    "%Y-%m-%dT%H:%M:%S",
)


@dataclass
class CsvActivityRow:
    activity_id: str
    name: str
    activity_date_raw: str
    sport_type_raw: str
    description: str | None
    filename: str | None
    is_commute: bool
    gear_name: str | None
    distance_m: float | None
    elapsed_time_s: int | None
    moving_time_s: int | None
    elevation_gain_m: float | None
    max_speed_ms: float | None
    average_speed_ms: float | None
    average_heart_rate: int | None
    max_heart_rate: int | None
    average_cadence: int | None
    max_cadence: int | None
    average_power: int | None
    max_power: int | None
    calories: int | None
    # Optional fields populated by summary-only sources (e.g. the Garmin
    # export, which has no per-activity file). The Strava CSV reader leaves
    # these ``None`` and derives them from the linked GPX/TCX/FIT instead.
    start_latitude: float | None = None
    start_longitude: float | None = None
    device_name: str | None = None
    normalized_power: float | None = None
    # Stable UTC start, used for cross-source de-duplication. Strava's CSV
    # "Activity Date" is already UTC; Garmin sets this from ``startTimeGmt``.
    start_utc: datetime | None = None
    raw: dict = field(default_factory=dict)

    def parsed_date(self) -> datetime | None:
        return parse_csv_date(self.activity_date_raw)


@dataclass
class AthleteProfileRow:
    athlete_id: str | None = None
    first_name: str | None = None
    last_name: str | None = None
    city: str | None = None
    state: str | None = None
    country: str | None = None
    sex: str | None = None


def parse_csv_date(value: str | None) -> datetime | None:
    if not value:
        return None
    value = value.strip()
    for fmt in _DATE_FORMATS:
        try:
            return datetime.strptime(value, fmt)
        except ValueError:
            continue
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).replace(tzinfo=None)
    except ValueError:
        return None


def _to_float(value: str | None) -> float | None:
    if value is None:
        return None
    value = value.strip().replace(",", "")
    if value == "":
        return None
    try:
        return float(value)
    except ValueError:
        return None


def _to_int(value: str | None) -> int | None:
    f = _to_float(value)
    return int(round(f)) if f is not None else None


def _pick(row: dict[str, str], *names: str) -> str | None:
    for name in names:
        if name in row and row[name] not in (None, ""):
            return row[name]
    return None


def _row_to_map(header: list[str], values: list[str]) -> dict[str, str]:
    """Build a header→value map, keeping the LAST value for duplicate headers."""
    mapping: dict[str, str] = {}
    for key, value in zip(header, values, strict=False):
        mapping[key] = value
    return mapping


class ExportReader:
    """Reads a Strava bulk export from either a ``.zip`` archive or a directory."""

    def __init__(self, source: str | Path):
        self.source = Path(source)
        self._zip: zipfile.ZipFile | None = None
        if self.source.is_file() and self.source.suffix.lower() == ".zip":
            self._zip = zipfile.ZipFile(self.source)
            self._names = set(self._zip.namelist())
        elif self.source.is_dir():
            self._names = {
                str(p.relative_to(self.source)) for p in self.source.rglob("*") if p.is_file()
            }
        else:
            raise FileNotFoundError(f"Export source not found or unsupported: {source}")

    def close(self) -> None:
        if self._zip is not None:
            self._zip.close()

    def __enter__(self) -> ExportReader:
        return self

    def __exit__(self, *exc) -> None:
        self.close()

    def _read_bytes(self, relative_path: str) -> bytes | None:
        relative_path = relative_path.lstrip("/")
        candidates = [relative_path]
        # Some exports store paths with or without a leading folder.
        if self._zip is not None:
            for name in candidates:
                if name in self._names:
                    return self._zip.read(name)
            # Match by suffix as a fallback (handles nested folders).
            for name in self._names:
                if name.endswith(relative_path):
                    return self._zip.read(name)
            return None
        for name in candidates:
            full = self.source / name
            if full.exists():
                return full.read_bytes()
        for name in self._names:
            if name.endswith(relative_path):
                return (self.source / name).read_bytes()
        return None

    def read_activity_file(self, filename: str) -> tuple[bytes, str] | None:
        """Return ``(decompressed_bytes, extension)`` for a per-activity file."""
        data = self._read_bytes(filename)
        if data is None:
            return None
        lowered = filename.lower()
        if lowered.endswith(".gz"):
            data = gzip.decompress(data)
            lowered = lowered[:-3]
        ext = lowered.rsplit(".", 1)[-1] if "." in lowered else ""
        return data, ext

    def read_activities_csv(self) -> list[CsvActivityRow]:
        raw = self._read_bytes("activities.csv")
        if raw is None:
            raise FileNotFoundError("activities.csv not found in export")
        text = raw.decode("utf-8-sig", errors="ignore")
        reader = csv.reader(io.StringIO(text))
        rows = list(reader)
        if not rows:
            return []
        header = rows[0]
        out: list[CsvActivityRow] = []
        for values in rows[1:]:
            if not values or not any(values):
                continue
            row = _row_to_map(header, values)
            activity_id = _pick(row, "Activity ID")
            if not activity_id:
                continue
            commute = (_pick(row, "Commute") or "").strip().lower() in (
                "true",
                "1",
                "yes",
            )
            activity_date = _pick(row, "Activity Date") or ""
            out.append(
                CsvActivityRow(
                    activity_id=str(activity_id).strip(),
                    name=_pick(row, "Activity Name") or "",
                    activity_date_raw=activity_date,
                    sport_type_raw=_pick(row, "Activity Type") or "",
                    description=_pick(row, "Activity Description"),
                    filename=_pick(row, "Filename"),
                    is_commute=commute,
                    gear_name=_pick(row, "Activity Gear"),
                    distance_m=_to_float(_pick(row, "Distance")),
                    elapsed_time_s=_to_int(_pick(row, "Elapsed Time")),
                    moving_time_s=_to_int(_pick(row, "Moving Time")),
                    elevation_gain_m=_to_float(_pick(row, "Elevation Gain")),
                    max_speed_ms=_to_float(_pick(row, "Max Speed")),
                    average_speed_ms=_to_float(_pick(row, "Average Speed")),
                    average_heart_rate=_to_int(_pick(row, "Average Heart Rate")),
                    max_heart_rate=_to_int(_pick(row, "Max Heart Rate")),
                    average_cadence=_to_int(_pick(row, "Average Cadence")),
                    max_cadence=_to_int(_pick(row, "Max Cadence")),
                    average_power=_to_int(_pick(row, "Average Watts")),
                    max_power=_to_int(_pick(row, "Max Watts")),
                    calories=_to_int(_pick(row, "Calories")),
                    # Strava "Activity Date" is recorded in UTC.
                    start_utc=parse_csv_date(activity_date),
                    raw=row,
                )
            )
        return out

    def count_activities(self) -> int:
        """Number of activities in the export (for the import preview)."""
        return len(self.read_activities_csv())

    def read_activity_rows(self) -> list[CsvActivityRow]:
        """Importer-facing alias (parallels ``GarminExportReader``)."""
        return self.read_activities_csv()

    def read_profile(self) -> AthleteProfileRow | None:
        """Parse ``profile.csv`` if present, tolerating header variations."""
        raw = self._read_bytes("profile.csv")
        if raw is None:
            return None
        text = raw.decode("utf-8-sig", errors="ignore")
        rows = list(csv.reader(io.StringIO(text)))
        if len(rows) < 2:
            return None
        # Normalise headers so lookups are case/spacing independent.
        header = [h.strip().lower() for h in rows[0]]
        values = rows[1]
        row = dict(zip(header, values, strict=False))
        return AthleteProfileRow(
            athlete_id=_clean(_pick_normalized(row, "athlete id", "id", "athleteid")),
            first_name=_clean(_pick_normalized(row, "first name", "firstname")),
            last_name=_clean(_pick_normalized(row, "last name", "lastname")),
            city=_clean(_pick_normalized(row, "city")),
            state=_clean(_pick_normalized(row, "state")),
            country=_clean(_pick_normalized(row, "country")),
            sex=_clean(_pick_normalized(row, "sex", "gender")),
        )


def _pick_normalized(row: dict[str, str], *names: str) -> str | None:
    for name in names:
        value = row.get(name)
        if value not in (None, ""):
            return value
    return None


def _clean(value: str | None) -> str | None:
    if value is None:
        return None
    cleaned = value.strip()
    return cleaned or None

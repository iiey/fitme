"""Reader for Garmin Connect bulk exports ("Export Your Data" / GDPR archive).

Garmin's export is structured completely differently from Strava's: there is no
``activities.csv``. Instead, activity summaries live in a
``*_summarizedActivities.json`` file (under ``DI_CONNECT/DI-Connect-Fitness``),
the athlete identity in ``DI-Connect-User/user_profile.json``, and the raw
per-activity ``.fit`` files in a *nested* ``DI-Connect-Uploaded-Files`` zip whose
members are named by upload-file id rather than activity id.

Because the JSON summaries already carry every metric FitMe stores, this
reader is *summary-driven*: it emits one :class:`CsvActivityRow` per activity so
the existing importer pipeline (identity, cross-source de-duplication, upsert)
can drive a Garmin export exactly like a Strava one.

Per-activity ``.fit`` files *are* linked back to their summaries: the uploaded
FIT files (named by upload id, not activity id) are indexed by their start time
and matched to each summary's ``startTimeGmt``. That gives full GPS tracks,
time-series streams and best-effort splits - so route maps and the heatmap work
for Garmin imports too. Activities without a matching FIT (or without GPS, e.g.
indoor strength) fall back to the summary's distance, time, HR, power and start
coordinate.

All Garmin units are converted to FitMe's SI base units here:

* distance / elevation are stored in **centimetres** -> divide by 100 for metres,
* durations are stored in **milliseconds** -> divide by 1000 for seconds,
* summarized ``avgSpeed`` / ``maxSpeed`` are stored at **1/10 m/s** -> times 10,
* ``startTimeLocal`` is an epoch already carrying the local offset, so reading it
  as UTC yields the naive local wall-clock time (matching the importer's
  preference for local time in weekday / time-of-day breakdowns).
"""

from __future__ import annotations

import io
import json
import zipfile
from datetime import datetime, timezone
from pathlib import Path

from app.enums import SportType
from app.ingestion.export import AthleteProfileRow, CsvActivityRow
from app.ingestion.fit import peek_activity_start

# Markers that identify a Garmin "Export Your Data" archive.
_SUMMARY_SUFFIX = "summarizedActivities.json"
_GARMIN_DIR_MARKER = "DI_CONNECT/"
# Nested archive (inside the export) that holds the raw per-upload FIT files.
_UPLOADED_MARKER = "uploaded-files"
# Match window (seconds) between a summary's GMT start and a FIT's first record.
_FIT_MATCH_WINDOW_S = 5


def _list_names(source: str | Path) -> list[str]:
    """List archive member paths for a ``.zip`` file or an extracted folder."""
    path = Path(source)
    if path.is_file() and path.suffix.lower() == ".zip":
        try:
            with zipfile.ZipFile(path) as zf:
                return zf.namelist()
        except zipfile.BadZipFile:
            return []
    if path.is_dir():
        return [str(p.relative_to(path)) for p in path.rglob("*") if p.is_file()]
    return []


def is_garmin_export(source: str | Path) -> bool:
    """Return ``True`` when ``source`` looks like a Garmin bulk export."""
    return any(
        name.endswith(_SUMMARY_SUFFIX) or _GARMIN_DIR_MARKER in name for name in _list_names(source)
    )


def _to_float(value: object) -> float | None:
    try:
        return float(value) if value is not None else None  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return None


def _int_or_none(value: object) -> int | None:
    f = _to_float(value)
    return int(round(f)) if f is not None else None


def _cm_to_m(value: object) -> float | None:
    f = _to_float(value)
    return f / 100.0 if f is not None else None


def _ms_to_s(value: object) -> int | None:
    f = _to_float(value)
    return int(round(f / 1000.0)) if f is not None else None


def _speed_ms(value: object) -> float | None:
    """Garmin summarized avg/max speed is stored at 1/10 of m/s."""
    f = _to_float(value)
    return f * 10.0 if f is not None else None


def _ms_to_local_dt(value: object) -> datetime | None:
    f = _to_float(value)
    if f is None:
        return None
    # Garmin ``*Local`` epochs already carry the local offset, so interpreting
    # them as UTC yields the naive local wall-clock datetime.
    return datetime.fromtimestamp(f / 1000.0, tz=timezone.utc).replace(tzinfo=None)


def _clean(value: object) -> str | None:
    if value is None:
        return None
    cleaned = str(value).strip()
    return cleaned or None


def _extract_summaries(data: object) -> list[dict]:
    """Flatten Garmin's ``summarizedActivities.json`` payload to a flat list.

    The file is normally ``[{"summarizedActivitiesExport": [ ... ]}]`` but we
    tolerate a bare list or dict for robustness across export versions.
    """
    blocks = data if isinstance(data, list) else [data]
    out: list[dict] = []
    for block in blocks:
        if isinstance(block, dict):
            out.extend(block.get("summarizedActivitiesExport", []) or [])
        elif isinstance(block, list):
            out.extend(item for item in block if isinstance(item, dict))
    return out


def _is_importable_summary(entry: dict) -> bool:
    """Whether a Garmin summary should be imported as its own activity.

    A multisport outing is exported as a ``parent`` container (``activityType``
    ``multi_sport``) *plus* one child activity per leg (each with its own sport,
    start and distance). Strava represents the same outing as those individual
    legs, so importing the parent would both double-count the distance/time and
    create an aggregate with no Strava counterpart. The parent is therefore
    skipped; its children import normally and line up with Strava's split.
    """
    if entry.get("parent") is True:
        return False
    if entry.get("activityType") == "multi_sport":
        return False
    return str(entry.get("sportType")) != "MULTISPORT"


def _summary_to_row(entry: dict) -> CsvActivityRow | None:
    activity_id = entry.get("activityId")
    if activity_id is None:
        return None

    sport = SportType.from_garmin(entry.get("activityType"), entry.get("sportType"))

    start_dt = _ms_to_local_dt(entry.get("startTimeLocal")) or _ms_to_local_dt(
        entry.get("beginTimestamp")
    )
    date_raw = start_dt.strftime("%Y-%m-%d %H:%M:%S") if start_dt else ""
    # ``startTimeGmt`` is the same instant in UTC - the stable basis for
    # cross-source de-duplication (``startTimeLocal`` carries a timezone offset).
    start_utc = _ms_to_local_dt(entry.get("startTimeGmt")) or _ms_to_local_dt(
        entry.get("beginTimestamp")
    )

    distance_m = _cm_to_m(entry.get("distance"))
    moving_s = _ms_to_s(entry.get("movingDuration")) or _ms_to_s(entry.get("duration"))
    elapsed_s = _ms_to_s(entry.get("elapsedDuration")) or _ms_to_s(entry.get("duration"))

    # Average speed is derived from distance / moving time (always SI-correct);
    # the scaled summary field is only a fallback when distance is missing.
    average_speed_ms = (
        distance_m / moving_s if distance_m and moving_s else _speed_ms(entry.get("avgSpeed"))
    )

    return CsvActivityRow(
        activity_id=str(activity_id),
        name=_clean(entry.get("name")) or sport.label,
        activity_date_raw=date_raw,
        # Store the resolved Strava-equivalent value so the importer's
        # ``SportType.from_strava`` re-resolves it to the same sport.
        sport_type_raw=sport.value,
        description=None,
        filename=None,
        is_commute=False,
        gear_name=None,
        distance_m=distance_m,
        elapsed_time_s=elapsed_s,
        moving_time_s=moving_s,
        elevation_gain_m=_cm_to_m(entry.get("elevationGain")),
        max_speed_ms=_speed_ms(entry.get("maxSpeed")),
        average_speed_ms=average_speed_ms,
        average_heart_rate=_int_or_none(entry.get("avgHr")),
        max_heart_rate=_int_or_none(entry.get("maxHr")),
        average_cadence=_int_or_none(entry.get("avgRunCadence") or entry.get("avgBikeCadence")),
        max_cadence=_int_or_none(entry.get("maxRunCadence") or entry.get("maxBikeCadence")),
        average_power=_int_or_none(entry.get("avgPower")),
        max_power=_int_or_none(entry.get("maxPower")),
        calories=_int_or_none(entry.get("calories")),
        start_latitude=_to_float(entry.get("startLatitude")),
        start_longitude=_to_float(entry.get("startLongitude")),
        device_name=_clean(entry.get("manufacturer")),
        normalized_power=_to_float(entry.get("normPower")),
        start_utc=start_utc,
        raw=entry,
    )


class GarminExportReader:
    """Reads a Garmin Connect bulk export (``.zip`` archive or folder).

    Mirrors the public surface of :class:`app.ingestion.export.ExportReader`
    (``read_activity_rows``, ``read_profile``, ``read_activity_file``,
    context-manager) so the importer can drive either source through the same
    pipeline.
    """

    def __init__(self, source: str | Path):
        self.source = Path(source)
        self._zip: zipfile.ZipFile | None = None
        if self.source.is_file() and self.source.suffix.lower() == ".zip":
            self._zip = zipfile.ZipFile(self.source)
            self._names = list(self._zip.namelist())
        elif self.source.is_dir():
            self._names = [
                str(p.relative_to(self.source)) for p in self.source.rglob("*") if p.is_file()
            ]
        else:
            raise FileNotFoundError(f"Export source not found or unsupported: {source}")
        self._summaries: list[dict] | None = None
        # FIT-file matching state (built lazily on first row read).
        self._fit_index: dict[int, str] | None = None
        self._fit_entry_zip: dict[str, zipfile.ZipFile | None] = {}
        self._nested_zips: list[zipfile.ZipFile] = []

    def close(self) -> None:
        for nz in self._nested_zips:
            nz.close()
        self._nested_zips = []
        if self._zip is not None:
            self._zip.close()

    def __enter__(self) -> GarminExportReader:
        return self

    def __exit__(self, *exc) -> None:
        self.close()

    def _read_bytes_endswith(self, suffix: str) -> bytes | None:
        for name in self._names:
            if name.endswith(suffix):
                if self._zip is not None:
                    return self._zip.read(name)
                return (self.source / name).read_bytes()
        return None

    def _read_member_bytes(self, name: str) -> bytes | None:
        """Read one member of the outer archive (zip) or export folder."""
        if self._zip is not None:
            try:
                return self._zip.read(name)
            except KeyError:
                return None
        path = self.source / name
        return path.read_bytes() if path.exists() else None

    def _ensure_fit_index(self) -> None:
        """Index every activity FIT by its start second (built once, lazily).

        Scans the nested ``Uploaded-Files`` archive(s) - and any FIT files stored
        directly - cheaply peeking each one's ``file_id``/first record so only
        true activity files (not daily-monitoring/wellness FITs) are indexed.
        """
        if self._fit_index is not None:
            return
        self._fit_index = {}
        for name in self._names:
            lname = name.lower()
            if lname.endswith(".zip") and _UPLOADED_MARKER in lname:
                raw = self._read_member_bytes(name)
                if raw is None:
                    continue
                try:
                    nested = zipfile.ZipFile(io.BytesIO(raw))
                except zipfile.BadZipFile:
                    continue
                self._nested_zips.append(nested)
                for entry in nested.namelist():
                    if not entry.lower().endswith(".fit"):
                        continue
                    start = peek_activity_start(nested.read(entry))
                    if start is None:
                        continue
                    sec = int(start.replace(tzinfo=timezone.utc).timestamp())
                    self._fit_index.setdefault(sec, entry)
                    self._fit_entry_zip.setdefault(entry, nested)
            elif lname.endswith(".fit"):
                raw = self._read_member_bytes(name)
                if raw is None:
                    continue
                start = peek_activity_start(raw)
                if start is None:
                    continue
                sec = int(start.replace(tzinfo=timezone.utc).timestamp())
                self._fit_index.setdefault(sec, name)
                self._fit_entry_zip.setdefault(name, None)

    def _lookup_fit(self, sec: int) -> str | None:
        """Find (and claim) the FIT whose start is nearest ``sec``, if any."""
        if not self._fit_index:
            return None
        for delta in range(_FIT_MATCH_WINDOW_S + 1):
            candidates = (sec,) if delta == 0 else (sec - delta, sec + delta)
            for second in candidates:
                entry = self._fit_index.pop(second, None)
                if entry is not None:
                    return entry
        return None

    def _load_summaries(self) -> list[dict]:
        if self._summaries is None:
            raw = self._read_bytes_endswith(_SUMMARY_SUFFIX)
            if raw is None:
                raise FileNotFoundError(
                    "No '*summarizedActivities.json' found in the Garmin export. "
                    "Make sure you uploaded the full 'Export Your Data' archive."
                )
            data = json.loads(raw.decode("utf-8-sig", errors="ignore"))
            self._summaries = _extract_summaries(data)
        return self._summaries

    def read_activity_rows(self) -> list[CsvActivityRow]:
        self._ensure_fit_index()
        rows: list[CsvActivityRow] = []
        for entry in self._load_summaries():
            if not _is_importable_summary(entry):
                continue
            row = _summary_to_row(entry)
            if row is None:
                continue
            gmt = entry.get("startTimeGmt") or entry.get("beginTimestamp")
            if gmt is not None:
                fit_entry = self._lookup_fit(int(float(gmt) // 1000))
                if fit_entry is not None:
                    # The importer reads streams via ``read_activity_file`` and
                    # derives the file type from this name (it ends in ``.fit``).
                    row.filename = fit_entry
            rows.append(row)
        return rows

    def count_activities(self) -> int:
        """Number of importable activities (excludes multisport containers)."""
        return sum(1 for e in self._load_summaries() if _is_importable_summary(e))

    def read_profile(self) -> AthleteProfileRow | None:
        """Resolve athlete identity from ``userProfileId`` + ``user_profile.json``."""
        athlete_id: str | None = None
        for entry in self._load_summaries():
            profile_id = entry.get("userProfileId")
            if profile_id is not None:
                athlete_id = str(profile_id)
                break

        first = last = sex = None
        raw = self._read_bytes_endswith("user_profile.json")
        if raw:
            try:
                profile = json.loads(raw.decode("utf-8-sig", errors="ignore"))
            except json.JSONDecodeError:
                profile = {}
            first = _clean(profile.get("firstName"))
            last = _clean(profile.get("lastName"))
            gender = (profile.get("gender") or "").strip().upper()
            if gender.startswith("M"):
                sex = "M"
            elif gender.startswith("F"):
                sex = "F"

        if athlete_id is None and first is None and last is None:
            return None
        return AthleteProfileRow(
            athlete_id=athlete_id,
            first_name=first,
            last_name=last,
            sex=sex,
        )

    def read_activity_file(self, filename: str) -> tuple[bytes, str] | None:
        """Return the matched FIT file's ``(bytes, "fit")`` for an activity row.

        ``filename`` is the FIT entry name assigned in :meth:`read_activity_rows`
        when a summary was matched to an uploaded FIT by start time. Rows with no
        match (or unreadable FITs) return ``None`` and import as summary-only.
        """
        if filename not in self._fit_entry_zip:
            return None
        nested = self._fit_entry_zip[filename]
        try:
            data = (
                nested.read(filename) if nested is not None else self._read_member_bytes(filename)
            )
        except (KeyError, zipfile.BadZipFile):
            return None
        if data is None:
            return None
        return data, "fit"

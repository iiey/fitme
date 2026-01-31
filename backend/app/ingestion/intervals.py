"""Thin read-only client for the Intervals.icu REST API.

Intervals.icu is an *aggregator*: its activities originate from Garmin, Strava,
direct uploads and others. This client is responsible only for HTTP and for
mapping the API's JSON shapes onto the internal types the ingestion pipeline
already understands:

* :func:`summary_to_row` turns an activity summary into a
  :class:`~app.ingestion.export.CsvActivityRow` (sport types are
  Strava-compatible, so the existing sport mapping applies directly);
* :meth:`IntervalsClient.get_streams` turns the per-activity streams into a
  :class:`~app.ingestion.parsed.ParsedActivityFile`;
* :meth:`IntervalsClient.download_original` fetches the gzip-compressed original
  file (when available) for the existing FIT/GPX/TCX parsers.

Authentication is HTTP Basic for personal use: username ``API_KEY``, password
the personal API key. Athlete id ``0`` in a path resolves to the key's athlete.
"""

from __future__ import annotations

import gzip
import time
from dataclasses import dataclass
from datetime import date, datetime

import httpx

from app.ingestion.export import CsvActivityRow
from app.ingestion.parsed import ParsedActivityFile

BASE_URL = "https://intervals.icu"
# Username for HTTP Basic auth; the password is the personal API key.
BASIC_AUTH_USER = "API_KEY"
DEFAULT_TIMEOUT = 30.0
DEFAULT_MAX_RETRIES = 3
DEFAULT_BACKOFF_BASE = 1.0
# Transient statuses worth retrying (rate limit + gateway/server errors).
_RETRY_STATUS = {429, 500, 502, 503, 504}
_AUTH_STATUS = {401, 403}


class IntervalsError(RuntimeError):
    """A non-recoverable error talking to the Intervals.icu API."""


class IntervalsAuthError(IntervalsError):
    """The API key (or athlete id) was rejected."""


@dataclass
class IntervalsAthlete:
    """Minimal identity returned by the athlete-profile endpoint."""

    id: str
    name: str | None


@dataclass
class SyncedActivity:
    """An Intervals.icu activity summary mapped to internal ingestion types.

    ``row`` feeds the shared upsert path; ``origin`` is the true source provider
    (garmin/strava/...) recorded in ``import_source``; ``file_type`` selects the
    parser when the original file is downloaded.
    """

    row: CsvActivityRow
    origin: str
    file_type: str | None


def _to_float(value: object) -> float | None:
    if value is None or isinstance(value, bool):
        return None
    try:
        return float(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return None


def _to_int(value: object) -> int | None:
    f = _to_float(value)
    return int(round(f)) if f is not None else None


def _first(*values: object) -> object:
    for value in values:
        if value is not None:
            return value
    return None


def parse_datetime(value: object) -> datetime | None:
    """Parse an Intervals.icu ISO timestamp to a naive datetime.

    A trailing ``Z`` (or explicit offset) on the UTC ``start_date`` is honoured
    and then dropped, yielding the naive UTC instant the rest of the pipeline
    uses. ``start_date_local`` is already offset-free and parses as-is.
    """
    if not isinstance(value, str) or not value.strip():
        return None
    text = value.strip()
    try:
        return datetime.fromisoformat(text.replace("Z", "+00:00")).replace(tzinfo=None)
    except ValueError:
        for fmt in ("%Y-%m-%dT%H:%M:%S", "%Y-%m-%d %H:%M:%S", "%Y-%m-%d"):
            try:
                return datetime.strptime(text, fmt)
            except ValueError:
                continue
    return None


def normalize_origin(source: object) -> str:
    """Normalise the Intervals.icu ``source`` connector to an origin label."""
    if not source:
        return "upload"
    text = str(source).strip().lower()
    if not text:
        return "upload"
    aliases = {"garmin_connect": "garmin", "garminconnect": "garmin"}
    return aliases.get(text, text)


def import_source_for(origin: str) -> str:
    """Build the ``import_source`` value recording a synced activity's origin."""
    return f"intervals/{origin or 'upload'}"


def _gear_name(activity: dict) -> str | None:
    gear = activity.get("gear")
    if isinstance(gear, dict):
        name = gear.get("name")
        return name or None
    return None


def _start_coords(activity: dict) -> tuple[float | None, float | None]:
    latlng = activity.get("start_latlng")
    if isinstance(latlng, (list, tuple)) and len(latlng) >= 2:
        return _to_float(latlng[0]), _to_float(latlng[1])
    return None, None


def summary_to_row(activity: dict) -> CsvActivityRow:
    """Map an Intervals.icu activity summary to a ``CsvActivityRow``.

    ``raw`` is deliberately a *stable subset* (start, type, distance, moving
    time, name) so the row fingerprint ignores Intervals.icu's volatile computed
    fields (fitness, fatigue, load) and only changes when the activity itself
    materially changes.
    """
    activity_id = str(activity.get("id") or "").strip()
    name = activity.get("name") or ""
    start_local = activity.get("start_date_local") or activity.get("start_date") or ""
    sport = activity.get("type") or activity.get("sport") or ""
    distance = _to_float(activity.get("distance"))
    moving = _to_int(activity.get("moving_time"))
    elapsed = _to_int(activity.get("elapsed_time"))
    elevation = _to_float(
        _first(activity.get("total_elevation_gain"), activity.get("icu_elevation_gain"))
    )
    lat, lng = _start_coords(activity)

    stable_subset = {
        "start": start_local,
        "type": sport,
        "distance": distance,
        "moving_time": moving,
        "name": name,
    }

    return CsvActivityRow(
        activity_id=activity_id,
        name=name,
        activity_date_raw=start_local,
        sport_type_raw=sport,
        description=activity.get("description"),
        filename=None,
        is_commute=bool(activity.get("commute")),
        gear_name=_gear_name(activity),
        distance_m=distance,
        elapsed_time_s=elapsed,
        moving_time_s=moving,
        elevation_gain_m=elevation,
        max_speed_ms=_to_float(activity.get("max_speed")),
        average_speed_ms=_to_float(activity.get("average_speed")),
        average_heart_rate=_to_int(activity.get("average_heartrate")),
        max_heart_rate=_to_int(activity.get("max_heartrate")),
        average_cadence=_to_int(activity.get("average_cadence")),
        max_cadence=_to_int(activity.get("max_cadence")),
        average_power=_to_int(
            _first(activity.get("icu_average_watts"), activity.get("average_watts"))
        ),
        max_power=_to_int(activity.get("max_watts")),
        calories=_to_int(activity.get("calories")),
        start_latitude=lat,
        start_longitude=lng,
        device_name=activity.get("device_name"),
        normalized_power=_to_float(activity.get("icu_weighted_avg_watts")),
        start_utc=parse_datetime(activity.get("start_date")),
        raw=stable_subset,
    )


def streams_payload_to_dict(payload: object) -> dict[str, list]:
    """Normalise a streams response into ``{stream_type: data}``.

    Intervals.icu returns either a list of ``{"type", "data"}`` objects or a map
    keyed by stream type; both are flattened here. Stream type names are
    Strava-compatible, so they line up with :class:`~app.enums.StreamType`.
    """
    streams: dict[str, list] = {}
    if isinstance(payload, list):
        for item in payload:
            if not isinstance(item, dict):
                continue
            stream_type = item.get("type")
            data = item.get("data")
            if isinstance(stream_type, str) and isinstance(data, list):
                streams[stream_type] = data
    elif isinstance(payload, dict):
        for stream_type, value in payload.items():
            if isinstance(value, dict) and isinstance(value.get("data"), list):
                streams[stream_type] = value["data"]
            elif isinstance(value, list):
                streams[stream_type] = value
    return streams


def _athlete_name(data: dict) -> str | None:
    name = data.get("name")
    if name:
        return str(name)
    parts = [data.get("first_name"), data.get("last_name")]
    joined = " ".join(p for p in parts if p)
    return joined or None


def _maybe_gunzip(data: bytes) -> bytes:
    """Decompress gzip content, passing through data that is not gzipped."""
    if len(data) >= 2 and data[0] == 0x1F and data[1] == 0x8B:
        try:
            return gzip.decompress(data)
        except OSError:
            return data
    return data


class IntervalsClient:
    """Read-only HTTP client for one Intervals.icu athlete (or ``0``).

    Use as a context manager so the underlying connection pool is closed::

        with IntervalsClient(api_key) as client:
            client.test_connection()
    """

    def __init__(
        self,
        api_key: str,
        icu_athlete_id: str = "0",
        *,
        base_url: str = BASE_URL,
        timeout: float = DEFAULT_TIMEOUT,
        client: httpx.Client | None = None,
        max_retries: int = DEFAULT_MAX_RETRIES,
        backoff_base: float = DEFAULT_BACKOFF_BASE,
        sleep=time.sleep,
    ) -> None:
        self._athlete = icu_athlete_id or "0"
        self._api = f"{base_url.rstrip('/')}/api/v1"
        self._max_retries = max_retries
        self._backoff_base = backoff_base
        self._sleep = sleep
        self._owns_client = client is None
        self._client = client or httpx.Client(
            auth=(BASIC_AUTH_USER, api_key),
            timeout=timeout,
            headers={"Accept": "application/json"},
        )

    def __enter__(self) -> IntervalsClient:
        return self

    def __exit__(self, *exc) -> None:
        self.close()

    def close(self) -> None:
        if self._owns_client:
            self._client.close()

    # -- HTTP ---------------------------------------------------------------

    def _backoff_seconds(self, response: httpx.Response | None, attempt: int) -> float:
        if response is not None:
            retry_after = response.headers.get("Retry-After")
            if retry_after:
                try:
                    return float(retry_after)
                except ValueError:
                    pass
        return self._backoff_base * (2**attempt)

    def _request(self, method: str, path: str, *, params: dict | None = None) -> httpx.Response:
        url = f"{self._api}{path}"
        response: httpx.Response | None = None
        for attempt in range(self._max_retries + 1):
            try:
                response = self._client.request(method, url, params=params)
            except httpx.TransportError as exc:
                if attempt >= self._max_retries:
                    raise IntervalsError(f"Network error calling {path}: {exc}") from exc
                self._sleep(self._backoff_seconds(None, attempt))
                continue
            if response.status_code in _RETRY_STATUS and attempt < self._max_retries:
                self._sleep(self._backoff_seconds(response, attempt))
                continue
            return response
        # Unreachable in practice: the loop returns or raises. Satisfy typing.
        assert response is not None
        return response

    def _raise_for_status(self, response: httpx.Response, *, context: str) -> None:
        if response.status_code in _AUTH_STATUS:
            raise IntervalsAuthError("Intervals.icu rejected the API key (or athlete id).")
        if response.status_code >= 400:
            raise IntervalsError(
                f"Intervals.icu request failed ({response.status_code}) while trying to {context}."
            )

    # -- Endpoints ----------------------------------------------------------

    def test_connection(self) -> IntervalsAthlete:
        """Validate credentials via the athlete-profile endpoint."""
        response = self._request("GET", f"/athlete/{self._athlete}")
        self._raise_for_status(response, context="validate credentials")
        data = response.json()
        if not isinstance(data, dict):
            raise IntervalsError("Unexpected athlete profile response.")
        return IntervalsAthlete(id=str(data.get("id") or self._athlete), name=_athlete_name(data))

    def list_activities(self, oldest: date, newest: date) -> list[SyncedActivity]:
        """Return activity summaries for the inclusive local-date range."""
        response = self._request(
            "GET",
            f"/athlete/{self._athlete}/activities",
            params={"oldest": oldest.isoformat(), "newest": newest.isoformat()},
        )
        self._raise_for_status(response, context="list activities")
        data = response.json()
        if not isinstance(data, list):
            raise IntervalsError("Unexpected activities response (expected a list).")
        activities: list[SyncedActivity] = []
        for item in data:
            if not isinstance(item, dict) or not item.get("id"):
                continue
            activities.append(
                SyncedActivity(
                    row=summary_to_row(item),
                    origin=normalize_origin(item.get("source")),
                    file_type=item.get("file_type"),
                )
            )
        return activities

    def get_streams(
        self,
        activity_id: str,
        *,
        start_utc: datetime | None = None,
        start_local: datetime | None = None,
    ) -> ParsedActivityFile | None:
        """Fetch per-activity streams as a ``ParsedActivityFile``, or ``None``.

        Strava-origin activities expose no streams through the API and yield
        ``None`` here, leaving only their summary data to be stored.
        """
        response = self._request("GET", f"/activity/{activity_id}/streams")
        if response.status_code == 404:
            return None
        self._raise_for_status(response, context="download streams")
        streams = streams_payload_to_dict(response.json())
        if not streams:
            return None
        return ParsedActivityFile(
            streams=streams, start_time=start_utc, start_time_local=start_local
        )

    def download_original(
        self, activity_id: str, file_type: str | None
    ) -> tuple[bytes, str] | None:
        """Download and decompress the original file, or ``None`` if unavailable.

        The endpoint returns the gzip-compressed original (fit/gpx/tcx). It is
        unavailable for Strava-origin activities (and when the file type is
        unknown there is no parser to dispatch to), in which case ``None`` is
        returned so the caller can fall back to the streams API.
        """
        if not file_type:
            return None
        ext = file_type.strip().lower()
        if ext not in ("fit", "gpx", "tcx"):
            return None
        response = self._request("GET", f"/activity/{activity_id}/file")
        if response.status_code in (403, 404, 204):
            return None
        self._raise_for_status(response, context="download original file")
        content = response.content
        if not content:
            return None
        return _maybe_gunzip(content), ext

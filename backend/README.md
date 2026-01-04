# StraStat — Backend (FastAPI)

Self-hosted Strava statistics dashboard. This is the Python/FastAPI backend that
ingests a **Strava bulk export** and serves aggregated statistics to the Next.js
frontend.

## Quick start

```bash
uv sync                  # create .venv and install deps (incl. dev) from uv.lock

# Run the API (creates the SQLite DB on first start).
uv run uvicorn app.main:app --reload --port 8000
```

## Importing data

1. Request a **bulk export** of your account from Strava
   (Settings → My Account → Download or Delete Your Account → Request Download).
2. Once you receive the `export_*.zip`, import it:

   ```bash
   uv run python -m app.cli import /path/to/export_12345.zip
   ```

   or via the API: `POST /api/import` with `{"source": "/path/to/export.zip"}`.

Re-running the import is **idempotent**: unchanged activities are skipped,
changed ones updated, new ones added. Safe to run on a schedule.

## Athlete configuration

Some statistics (training load, HR/power zones, W/kg) need data not present in
the export. Edit [`config/athlete.yaml`](config/athlete.yaml).

## Tests

```bash
uv run pytest
```

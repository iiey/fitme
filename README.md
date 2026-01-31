# FitMe

A self-hosted, single-user statistics dashboard for your training data - built
with a **Python / FastAPI** backend and a **React / Next.js** frontend.
Inspired by [statistics-for-strava](https://github.com/robiningelbrecht/statistics-for-strava),
FitMe ingests your **Strava bulk export** (and Garmin bulk zips) and turns
them into rich, interactive insights - no live API connection needed.

## Features

| Page | What it shows |
| --- | --- |
| **Dashboard** | Totals, activity heatmap calendar, streaks, Eddington, monthly/weekly trends, HR/power/pace zones, peak power, weekday/daytime/distance distributions, recent activities & milestones |
| **Fitness** | Training load analysis - CTL/ATL/TSB chart, form zones, acute:chronic ratio, monotony, strain & weekly TRIMP |
| **Activities** | Searchable, sortable, paginated table of every activity + a detail view with route map and stream charts (elevation, HR, speed, power) |
| **Calendar** | Interactive month calendar with per-day intensity and per-sport breakdowns |
| **Heatmap** | All routes drawn on a Leaflet map, coloured by sport, with filters |
| **Milestones** | Grouped, filterable timeline of achievements with fun comparisons |
| **Rewind** | Year-in-review with monthly totals, sport breakdown, start-time histogram, calories/carbon equivalents, biggest activity and more |

## Architecture

```
fitme/
├── backend/     FastAPI + SQLAlchemy + SQLite (+ Alembic)
│   ├── app/
│   │   ├── ingestion/   Strava/Garmin export readers + FIT/GPX/TCX parsers
│   │   ├── domain/      Eddington, training load, milestones, rewind, stats, VO2max
│   │   └── api/         REST routers (one per feature)
│   └── tests/
├── frontend/    Next.js (App Router, TS) + Tailwind + ECharts + Leaflet
└── sample-data/ A synthetic export for trying things out
```

The frontend proxies `/api/*` to the backend, so the browser only talks to one origin.

## Quick start (local)

The fastest path uses the bundled [`Makefile`](Makefile) (run `make help` for all targets):

```bash
make install     # install backend (uv) + frontend (npm) dependencies
make seed        # migrate the DB, generate sample data and import it
make run         # run backend (:8000) and frontend (:3000) together
```

Then open <http://localhost:3000>. Prefer to do it by hand? See below.

### 1. Backend

```bash
cd backend
uv sync                         # create .venv + install deps (incl. dev) from uv.lock
uv run alembic upgrade head     # create the database

# Generate a synthetic sample export (or skip and use your own - see below).
uv run python scripts/generate_sample_export.py

# Import data - use the bundled sample, or your own Strava export zip/folder.
uv run python -m app.cli import ../sample-data/strava-export

uv run uvicorn app.main:app --reload --port 8000
```

### 2. Frontend

```bash
cd frontend
npm install
npm run dev        # http://localhost:3000
```

## Importing your data

### Strava

1. On Strava: **Settings → My Account → Download or Delete Your Account →
   Request your archive**. You'll receive an `export_*.zip` by email.
2. Import it one of three ways:

   - **In the app (easiest):** click **Import data** in the bottom-left of the
     sidebar and upload the `.zip` (or point it at a path on the server).
   - **CLI:** `uv run python -m app.cli import /path/to/export_12345.zip`
     (or `make import SOURCE=/path/to/export_12345.zip`).
   - **API:** `POST /api/import` with `{"source": "/path/to/export.zip"}`,
     or `POST /api/import/upload` with the file as multipart form-data.

### Garmin

Use **Garmin's bulk export** the same way - the importer auto-detects the
source format. When both a Strava and Garmin export contain the same workout,
cross-source deduplication prevents double-counting.

**Re-imports are idempotent.** Running the import again on an updated export
adds new activities, updates changed ones and skips the rest - run it on a
schedule without creating duplicates.

The athlete's name and profile link (bottom-left of the sidebar) are read
from `profile.csv` in the export, when present.

## Athlete configuration

Some stats (training load, HR/power/pace zones, W/kg) need data that isn't in
the export. Edit [`backend/config/athlete.yaml`](backend/config/athlete.yaml) to
set your birthday, sex, weight, FTP, max/resting heart rate, threshold pace, zone
boundaries and unit system.

## Running with Docker

```bash
docker compose up --build
# Frontend: http://localhost:3000   Backend: http://localhost:8000
```

Then import data into the running backend container:

```bash
docker compose exec backend python -m app.cli import /data/strava-export
```

## Development

```bash
make lint        # ruff + eslint + tsc
make test        # backend pytest
make check       # lint + test + frontend build
```

Or run the tools directly:

```bash
# Backend
cd backend
uv run ruff check app && uv run pytest

# Frontend
cd frontend
npm run lint && npm run typecheck && npm run build
```

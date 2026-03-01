# FitMe

A self-hosted, single-user statistics dashboard for your training data - built
with a **Python / FastAPI** backend and a **React / Next.js** frontend.

Inspired by [statistics-for-strava][statistics_for_strava] (which works only
through the Strava API), FitMe ingests your **Garmin bulk export** and **Strava
bulk zips**, or syncs continuously from **Intervals.icu**, turning them into
rich, interactive insights.

## Features

| Page | Info |
| --- | --- |
| **Dashboard** | Totals, activity heatmap calendar, streaks, Eddington, monthly/weekly trends, HR/power/pace-zones, peak power, weekday/daytime/distance distributions, recent activities & milestones |
| **Fitness** | Training load analysis - `CTL/ATL/TSB` chart, form zones, acute:chronic ratio, monotony, strain & weekly TRIMP |
| **Activities** | Searchable, sortable, paginated table of every activity + a detail view with route map and stream charts (elevation, HR, speed, power) |
| **Calendar** | Interactive month calendar with per-day intensity and per-sport breakdowns |
| **Goals** | Targets over flexible date ranges (distance, time, elevation, count or calories) with live progress tracking |
| **Heatmap** | All routes drawn on a Leaflet map, coloured by sport, with filters |
| **Milestones** | Grouped, filterable timeline of achievements with fun comparisons |
| **Rewind** | Year-in-review with monthly totals, sport breakdown, start-time histogram, calories/carbon equivalents, biggest activity and more |
| **FitBuddy** | Optional [ai-coach](#ai-coach-fitbuddy) - a chat drawer that answers questions about your training data, grounded in the real numbers |

## Installation

Self-hosting uses Docker. You need [Docker][docker_install] with the Compose
plugin (`docker compose`)

```bash
docker compose up --build -d
```

- **App (frontend):** <http://localhost:3000>
- **API (backend):** <http://localhost:8000>

The backend applies database migrations on startup and keeps all state - the
SQLite database and any uploaded files - under `backend/storage/`, which is
mounted as a volume, so your data survives container restarts and rebuilds.

Once the app is up, **import your data from within the app**: click **Import
data** in the bottom-left of the sidebar and upload your export - no command
line needed (see [Importing your data](#importing-your-data)).

Common commands:

```bash
docker compose up --build -d   # start (rebuild images), in the background
docker compose logs -f         # follow logs
docker compose down            # stop
```

## Importing your data

For most users the easiest path is the **Import data** button in the app
(bottom-left of the sidebar): upload your export `.zip` and FitMe takes care of
the rest. The importer **auto-detects the source format** (Garmin, Strava), and
**re-imports are idempotent** - running an import again on an updated export
adds new activities, updates changed ones and skips the rest, so you can re-run
it without creating duplicates. When both a Strava and Garmin export contain the
same workout, cross-source deduplication prevents double-counting.

### Garmin

Use **Garmin's bulk export** and import it the same way. The athlete's name and
profile link (bottom-left of the sidebar) are read from `profile.csv` in the
export, when present.

### Strava

1. On Strava: **Settings -> My Account -> Download your account ->
   Get Started -> Request download**. You'll receive an `export_*.zip` by email.
2. Import it via the **Import data** button in the app, or one of the
   alternatives below.

> **Caveat - sport classification is coarser via Strava.** Garmin and Coros
> devices record activities with the FIT protocol's `sport + sub_sport` fields,
> giving fine-grained types (e.g. "Trail Run" vs "Run"). Strava flattens these
> into a single type string, so activities that reached Strava by syncing from
> Garmin lose that detail *before* the export is even created - re-importing
> them into FitMe cannot recover it. **For the most accurate sport
> classification, import directly from a Garmin or Coros bulk export whenever
> possible**, and prefer it over the Strava copy when the same workout exists in
> both (cross-source deduplication keeps it from being counted twice).

### Intervals.icu

Assuming you have an [Intervals.icu][intervals_icu] account and have
[connected your wearable(s)][intervals_connect] to it, add an Intervals.icu API
key on the **Settings** page to **pull new activities automatically** -
incremental, and deduplicated against your bulk imports.

### Alternatives to the in-app upload

These are mainly useful for automation or very large exports:

- **Server path:** in the **Import data** dialog, point FitMe at a path on the
  server instead of uploading. Under Docker, mount your export folder into the
  backend container (the bundled `docker-compose.yml` mounts `./sample-data` to
  `/data` as an example) and reference it by that path.
- **CLI:** `uv run python -m app.cli import /path/to/export_12345.zip`
  (or `make import SOURCE=/path/to/export_12345.zip`).
- **API:** `POST /api/import` with `{"source": "/path/to/export.zip"}`,
  or `POST /api/import/upload` with the file as multipart form-data.

## Athlete configuration

Some stats (training load, HR/power/pace zones, W/kg) need data that isn't in
the export. Open the **Settings** page in the UI to set your birthday, sex,
weight, FTP, max/resting heart rate, threshold pace, zone boundaries and unit
system.

## AI Coach (FitBuddy)

FitBuddy is an optional, self-contained AI coaching assistant: a chat drawer that
answers questions about *your* training data, grounded in the real numbers via
tool calls rather than guesswork. It is a removable [plug-in module][plug_in_module] -
disabled and invisible until you configure a provider (Ollama, OpenAI, or
Anthropic) on the **Settings** page.

Enable it by installing the optional extra, then configure a model in Settings:

```bash
cd backend
uv sync --extra coach
```

See [doc/coach.md][plug_in_module] for the architecture, the separate `coach.db`
data model, and an implementation overview.

## Architecture

```
fitme/
├── backend/     FastAPI + SQLAlchemy + SQLite (+ Alembic)
│   ├── app/
│   │   ├── ingestion/   Garmin/Strava export readers + FIT/GPX/TCX parsers
│   │   ├── domain/      Eddington, training load, milestones, rewind, stats, VO2max
│   │   └── api/         REST routers (one per feature)
│   └── tests/
├── frontend/    Next.js (App Router, TS) + Tailwind + ECharts + Leaflet
└── sample-data/ A synthetic export for trying things out
```

The frontend proxies `/api/*` to the backend, so the browser only talks to one origin.

## Development (unix)

The fastest path uses the bundled [`Makefile`][makefile] (run `make help` for all targets):

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

### Quality checks

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

<!-- Reference links -->
[docker_install]: https://docs.docker.com/get-docker/
[intervals_icu]: https://intervals.icu
[makefile]: Makefile
[plug_in_module]: doc/coach.md
[statistics_for_strava]: https://github.com/robiningelbrecht/statistics-for-strava
[intervals_connect]: https://intervals.icu/settings/connections

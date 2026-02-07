# FitMe - Architecture Insights

> Architecture, data flow, performance strategy, and known limitations.

---

## 1. Overview

FitMe is a self-hosted, single-user statistics dashboard for training data. It ingests **Strava and Garmin bulk exports** and supports **live sync via Intervals.icu**, producing interactive analytics across eight feature pages: Dashboard, Fitness, Activities, Calendar, Goals, Heatmap, Milestones, and Rewind.

| Layer | Stack |
|-------|-------|
| **Backend** | Python 3.12, FastAPI, SQLAlchemy 2 ORM, SQLite (WAL mode), Alembic migrations, Pydantic 2 |
| **Frontend** | Next.js 15 (App Router), React 19, TypeScript 5.7, Tailwind CSS 3.4, ECharts 5.6, Leaflet, SWR 2.3, Zod |
| **Infra** | Docker Compose (2 services), uv for Python packaging, standalone Next.js output, GitHub Actions CI |

---

## 2. Architecture

```
Browser
  │
  ▼
Next.js (:3000)          ←  rewrites /api/* to backend
  │
  ▼
FastAPI (:8000)           ←  REST API, one router per feature
  │
  ▼
SQLite (WAL mode)         ←  single file, zero-config
```

The frontend uses Next.js API rewrites (`/api/*` → `http://backend:8000/api/*`) so the browser only talks to one origin. Data fetching uses SWR with Zod-validated fetch wrappers.

### 2.1 Directory Structure

```
fitme/
├── backend/
│   ├── app/
│   │   ├── api/            # REST routers (one per feature page)
│   │   │   ├── activities.py  # List, detail, note update
│   │   │   ├── athletes.py    # Multi-athlete admin + config + athlete resolution
│   │   │   ├── calendar.py
│   │   │   ├── dashboard.py
│   │   │   ├── eddington.py
│   │   │   ├── goals.py       # CRUD + progress aggregation
│   │   │   ├── heatmap.py
│   │   │   ├── imports.py
│   │   │   ├── meta.py
│   │   │   ├── milestones.py
│   │   │   ├── rewind.py
│   │   │   ├── sync.py        # Intervals.icu sync config + trigger
│   │   │   └── serializers.py
│   │   ├── domain/         # Business logic (stateless, no DB access)
│   │   │   ├── best_efforts.py
│   │   │   ├── dedup.py       # Cross-source deduplication fingerprints
│   │   │   ├── eddington.py
│   │   │   ├── math_utils.py
│   │   │   ├── milestones.py
│   │   │   ├── rewind.py
│   │   │   ├── search.py
│   │   │   ├── stats.py
│   │   │   ├── streams_analysis.py
│   │   │   ├── training_load.py
│   │   │   ├── units.py
│   │   │   └── vo2max.py      # VO2max estimation
│   │   ├── ingestion/      # Import pipeline
│   │   │   ├── importer.py    # Orchestration + dedup
│   │   │   ├── export.py      # Strava CSV reader
│   │   │   ├── garmin.py      # Garmin bulk-zip reader
│   │   │   ├── parsed.py      # Unified activity structure
│   │   │   ├── parallel.py    # Parallel file parsing
│   │   │   ├── fit.py         # FIT file decoder
│   │   │   ├── gpx.py         # GPX parser
│   │   │   ├── tcx.py         # TCX parser
│   │   │   └── polyline.py    # RDP downsampling
│   │   ├── models.py       # SQLAlchemy models (9 tables)
│   │   ├── enums.py        # StreamType, sport/activity enums
│   │   ├── repository.py   # Data access layer
│   │   ├── athlete.py      # Athlete config loader (DB-backed)
│   │   ├── types.py        # Custom types (CompressedJSON)
│   │   └── main.py         # FastAPI app entry
│   ├── alembic/            # Database migrations
│   ├── config/             # (reserved for future config files)
│   └── tests/
├── frontend/
│   ├── app/                # Next.js App Router pages
│   │   ├── page.tsx             # Dashboard (incl. Eddington modal)
│   │   ├── fitness/page.tsx     # Training load / form analysis
│   │   ├── activities/page.tsx  # Activity list
│   │   ├── activities/[id]/     # Activity detail (with inline note editor)
│   │   ├── calendar/page.tsx
│   │   ├── goals/page.tsx       # Goal CRUD with progress tracking
│   │   ├── heatmap/page.tsx
│   │   ├── milestones/page.tsx
│   │   ├── rewind/page.tsx
│   │   └── settings/page.tsx    # Sync config + athlete training params
│   ├── components/
│   │   ├── charts/         # EChart wrapper + config
│   │   ├── layout/         # Sidebar
│   │   ├── map/            # Leaflet route/heatmap views
│   │   ├── import/         # Upload dialog
│   │   └── ui/             # Card, DataTable, Skeleton, ThemeToggle, etc.
│   └── lib/
│       ├── api.ts          # SWR hooks + Zod-validated fetchers
│       ├── athlete-context.tsx  # React context for active athlete
│       ├── echarts.ts      # Tree-shaken ECharts setup
│       ├── format.ts       # Number/date formatting helpers
│       ├── polyline.ts     # Polyline decoding
│       ├── schemas.ts      # Zod response schemas
│       ├── types.ts        # TypeScript interfaces
│       └── use-is-dark.ts  # Dark-mode detection hook
└── docker-compose.yml
```

---

## 3. Data Model

Nine tables, scoped per athlete:

| Table | Primary Key | Purpose |
|-------|-------------|---------|
| `activity` | `activity_id` (string) | Core activity record - distance, time, elevation, HR, power, sport type, gear, polyline, user note |
| `activity_stream` | `(activity_id, stream_type)` | Time-series data (heartrate, watts, speed, altitude, etc.) as zlib-compressed JSON blobs |
| `best_effort` | `(activity_id, distance_m)` | Fastest time over standard distances (400 m, 1 km, 5 km, etc.) |
| `gear` | `gear_id` (hash of name) | Bikes / shoes with accumulated distance |
| `goal` | auto-increment | Training targets over flexible date ranges, progress computed at query time |
| `sync_config` | `provider` (string) | Credentials and watermark for continuous Intervals.icu sync |
| `import_run` | auto-increment | Audit trail: timestamp, source path, counts (created/updated/skipped/errors) |
| `athlete_profile` | `athlete_id` (string) | Athlete identity + training parameters (FTP, HR, weight, zones, unit system) |
| `source_identity` | `(source, source_athlete_id)` | Maps a provider's athlete ID to the canonical `athlete_id` for cross-source merging |

### 3.1 CompressedJSON Storage

Activity streams are stored using a custom `CompressedJSON` SQLAlchemy type ([backend/app/types.py](backend/app/types.py)) that transparently compresses on write (zlib) and decompresses on read:

```
Write path:  Python list → JSON string → zlib compress → BLOB column
Read path:   BLOB column → zlib decompress → JSON parse → Python list
```

This reduces stream storage by ~70–80% compared to raw JSON.

---

## 4. Import Pipeline

### 4.1 Supported Formats

The importer accepts a **Strava** or **Garmin** bulk export (zip or extracted folder).

**Strava** exports contain:
- `activities.csv` - activity metadata
- `activities/*.fit`, `*.gpx`, `*.tcx` - activity streams/routes
- `profile.csv` - athlete identity

**Garmin** bulk zips contain FIT files with embedded metadata; no separate CSV.

### 4.2 Import Flow

```
Strava export (zip/folder)
  │
  ▼
export.py reads activities.csv
  │
  ▼
For each row:
  ├── Hash CSV row (SHA1) for idempotency
  ├── Check existing: same hash → skip, different hash → update, new → insert
  ├── Parse activity file (FIT/GPX/TCX) for streams + route
  ├── RDP-downsample polyline coordinates
  ├── Compute best efforts from GPS/time streams
  └── Store activity + streams + best efforts
  │
  ▼
Parse profile.csv → upsert AthleteProfile (id=1)
  │
  ▼
Record ImportRun with counts
```

### 4.3 Idempotency

Re-imports are safe. The importer uses a SHA1 hash of the raw CSV row (`source_hash`) to detect changes:

- **Same hash** → skip entirely (no DB writes)
- **Different hash** → update activity fields, delete and recreate streams/best-efforts
- **New activity** → insert

### 4.4 Background Execution

Imports run in a background thread (`ThreadPoolExecutor`) to avoid blocking HTTP responses. The API returns immediately with an import ID; the client polls for completion.

---

## 5. [intervals.icu](https://intervals.icu) Connector

Beyond bulk imports, FitMe supports **continuous incremental sync** via the [intervals.icu REST API](https://intervals.icu/api/v1/docs/swagger-ui/index.html).
Intervals.icu is a free training platform that aggregates activities from Garmin Connect, Strava, etc..
and direct uploads - making it an ideal intermediary when those providers' own APIs are paid.

### 5.1 Intervals.icu API Endpoints

Authentication is HTTP Basic:
- *username* literally the word `API_KEY`
- *password* is the personal API key
- *athlete_id* `0` resolves to the key owner.

| Endpoint                                | Method | Purpose                                           |
|-----------------------------------------|--------|---------------------------------------------------|
| `/api/v1/athlete/{id}`                  | GET    | Validate credentials, fetch athlete profile       |
| `/api/v1/athlete/{id}/activities`       | GET    | List activity summaries (`oldest`/`newest` params) |
| `/api/v1/activity/{id}/streams`         | GET    | Per-activity time-series (HR, power, GPS, etc.)   |
| `/api/v1/activity/{id}/file`            | GET    | Download original FIT/GPX/TCX (gzip-compressed)   |

### 5.2 Sync Flow

```
SyncConfig in DB (credentials + watermark)
  │
  ▼
Determine date range:
  ├── Has watermark? → oldest = watermark − 7 days (overlap buffer)
  ├── No watermark?  → oldest = MAX(start_date_time) across all sources
  └── No activities?  → oldest = 90 days ago
  │
  ▼
GET /api/v1/athlete/{id}/activities?oldest=...&newest=...
  │
  ▼
For each activity:
  ├── Source hash unchanged → skip (idempotent)
  ├── Cross-source dedup match (Strava/Garmin twin) → skip
  ├── New or changed → fetch detail:
  │     ├── Try: download original file → parse with FIT/GPX/TCX parser
  │     └── Fallback: GET streams API → build ParsedActivityFile
  ├── Upsert via shared ingestion path (same as bulk import)
  └── Advance watermark to newest activity seen
  │
  ▼
Commit + update SyncConfig.synced_through
```

### 5.3 Key Properties

- **Incremental** - only fetches activities after the stored watermark, with a 7-day overlap buffer for late-arriving or edited activities.
- **Idempotent** - SHA1 fingerprint of stable fields (start, type, distance, moving time, name) detects unchanged activities. Volatile Intervals.icu-computed fields (fitness, fatigue) are excluded from the fingerprint.
- **Cross-source safe** - activities synced as `source="intervals"` are deduplicated against existing Strava/Garmin data using the same tolerant matching (3 min start time, 250 m / 5% distance).
- **Hybrid detail fetch** - prefers the original file (FIT/GPX/TCX) for full-fidelity streams; falls back to the streams API when the original is unavailable (e.g. Strava-origin activities).
- **Non-blocking** - runs in a daemon thread under a shared lock with bulk imports (never concurrent writes). UI polls `GET /api/sync/status` for progress.
- **Configurable** - credentials and sync toggle managed via Settings page; stored in the `sync_config` table per athlete.

### 5.4 Auto Sync

Beyond the manual "Sync now" button and external cron, the backend runs one sync automatically on the **first app start of each day**, a hands-off daily refresh for the self-hosted single-process deployment.

- **Once per day** - the run date is persisted in `sync_config.last_auto_sync_on` (UTC); repeated restarts or `uvicorn --reload` on the same day are skipped, so it never re-syncs on every boot.
- **Only when configured** - fires only if a `SyncConfig` exists with a stored API key and `enabled=true`; otherwise it is a silent no-op.
- **Same engine** - reuses the manual trigger's path: a daemon thread under the shared ingestion lock, observable via `GET /api/sync/status`.
- **Never fatal** - any startup failure is logged and swallowed so it cannot block app start-up; the day's slot is still consumed, so a transient failure waits for the next day or a manual trigger.
- **Toggle** - controlled by `FITME_STARTUP_SYNC_ENABLED` (default on), and independent of the manual/cron triggers, which keep their own run-state.

---

## 6. API Layer

All endpoints live under `/api/`. The frontend proxies requests through Next.js rewrites.

| Endpoint                        | Method         | Description                                                                          |
|---------------------------------|----------------|--------------------------------------------------------------------------------------|
| `/api/meta`                     | GET            | Athlete info, sport types, activity count                                            |
| `/api/dashboard`                | GET            | Aggregated stats (totals, trends, distributions, training load, HR zones, peak power) |
| `/api/activities`               | GET            | Paginated, filterable activity list                                                  |
| `/api/activities/{id}`          | GET            | Single activity with streams                                                         |
| `/api/activities/{id}/note`     | PUT            | Update user note on an activity                                                      |
| `/api/athletes`                 | GET            | List all athlete profiles                                                            |
| `/api/athletes/{id}`            | DELETE         | Delete an athlete and all their data                                                 |
| `/api/athletes/config`          | GET/PUT        | Read or update athlete training parameters                                           |
| `/api/calendar/{year}/{month}`  | GET            | Monthly calendar data                                                                |
| `/api/eddington`                | GET            | Eddington number + progression                                                       |
| `/api/goals`                    | GET/POST       | List or create training goals                                                        |
| `/api/goals/progress`           | GET            | Goals enriched with current progress from activity aggregation                       |
| `/api/goals/{id}`               | PUT/DELETE     | Update or delete a goal                                                              |
| `/api/heatmap/routes`           | GET            | Paginated polylines for map rendering                                                |
| `/api/milestones`               | GET            | Achievement timeline                                                                 |
| `/api/rewind/{year}`            | GET            | Year-in-review statistics                                                            |
| `/api/import`                   | POST           | Trigger import from server path                                                      |
| `/api/import/upload`            | POST           | Upload and import zip file                                                           |
| `/api/import/preview`           | POST           | Preview import (counts, source detection) before executing                           |
| `/api/import/runs`              | GET            | List all import runs                                                                 |
| `/api/import/runs/{id}`         | GET            | Poll a specific import run's status                                                  |
| `/api/sync/config`              | GET/PUT/DELETE | Manage Intervals.icu sync credentials                                                |
| `/api/sync/status`              | GET            | Current sync state (pollable)                                                        |
| `/api/sync/trigger`             | POST           | Manually trigger a sync run                                                          |
| `/health`                       | GET            | Health check (DB connectivity)                                                       |

### 5.1 Cache-Control

Stable read endpoints return `Cache-Control: public, max-age=300` (5 minutes). The meta endpoint uses a shorter TTL since it reflects import state.

---

## 7. Dashboard Computation

The dashboard endpoint is the most computation-heavy. It computes 13 independent sections:

```
1. Request arrives with optional filters (sport_type, year, date range)
2. Pre-fetch all needed DB data sequentially:
   - activities (SQL-filtered, not full table scan)
   - activity streams (batch load for heartrate, watts, time)
   - best efforts
   - gear records
   - distinct years (lightweight SQL query)
3. Dispatch 13 computations to ThreadPoolExecutor(max_workers=4):
   - totals, streaks, eddington, monthly trends, weekly trends,
     training load, weekday distribution, daytime distribution,
     distance distribution, HR zones, peak power, recent activities, milestones
4. Collect results via as_completed, assemble response
```

### 7.1 Key Optimizations

| Optimization | What it does |
|-------------|-------------|
| **SQL-level filtering (P1)** | Dashboard filters (sport, year, date) are pushed into SQL WHERE clauses instead of loading all activities into Python |
| **N+1 query elimination (P2)** | Streams for HR zones and peak power are batch-loaded in one query instead of one query per activity |
| **Eddington LRU cache (P3)** | `compute_eddington()` results are cached with `@lru_cache(maxsize=64)` keyed on an MD5 hash of the input data |
| **Parallel computation (P4)** | 13 CPU-bound computations run on a 4-worker thread pool instead of sequentially |
| **Compressed streams (P6)** | Activity stream BLOB storage uses zlib compression (~70-80% reduction) |

---

## 8. Frontend Architecture

### 8.1 Data Fetching

SWR hooks in `lib/api.ts` handle reads; standalone async functions handle writes
(notes, goals, config, sync). Responses are Zod-validated before reaching
components.

```
Reads:   Component → useDashboard() → SWR → validated(DashboardSchema) → fetch → Zod.parse()
Writes:  Component → updateGoal()   → fetch(PUT) → mutate() to revalidate SWR cache
```

### 8.2 Performance Patterns

| Pattern | Implementation |
|---------|---------------|
| **Deferred rendering** | Below-fold dashboard sections use `IntersectionObserver` - components only mount when scrolled into view |
| **Skeleton loading** | `CardSkeleton` placeholders shown while deferred sections wait |
| **ECharts tree-shaking** | Only bar, line, and pie chart modules are imported (not the full 800KB bundle) |
| **RDP polyline downsampling** | GPS coordinates are simplified during import using Ramer-Douglas-Peucker algorithm |
| **URL state persistence** | Activity list pagination/filters are stored in URL search params |

### 8.3 Dark Mode

Dark mode uses Tailwind's `class` strategy with CSS custom properties:

- Three modes: light, dark, system (auto-detect via `prefers-color-scheme`)
- Persisted to `localStorage`, applied by toggling `.dark` on `<html>`
- Surface colors use CSS variables (`--surface`, `--surface-muted`) for seamless theme switching
- `ThemeToggle` component cycles through modes: light → dark → system

---

## 9. Infrastructure

### 9.1 Docker Compose

Two services:

| Service | Image | Port | Notes |
|---------|-------|------|-------|
| `backend` | `python:3.12-slim` + uv | 8000 | Runs Alembic migrations on startup, health check via `/health` |
| `frontend` | `node:22-slim` (multi-stage) | 3000 | Standalone Next.js output, rewrites `/api/*` to backend |

### 9.2 SQLite Configuration

- **WAL mode** enabled at connection time for concurrent read/write
- Single-file database, no external DB server required
- Alembic manages schema migrations

### 9.3 CI Pipeline (GitHub Actions)

Three parallel jobs:

```yaml
backend:   uv sync → ruff check → ruff format --check → pytest
frontend:  npm ci → next lint → tsc --noEmit
docker:    docker build (backend + frontend) - verify images build, no push
```

---

## 10. Configuration

### 10.1 Environment Variables

Documented in `.env.example` (backend vars use the `FITME_` prefix):

| Variable | Purpose |
|----------|---------|
| `FITME_DATABASE_URL` | SQLite connection string |
| `FITME_CORS_ORIGINS` | Allowed frontend origins |
| `BACKEND_URL` | Frontend-side: backend URL for API proxying |

### 10.2 Athlete Configuration

Training parameters are stored on the `athlete_profile` table and editable
from the Settings page.

- **Birthday / sex** - age-based max-HR fallback (Tanaka formula)
- **Weight** - for W/kg metrics
- **FTP** (Functional Threshold Power) - power zone calculations
- **Max / resting heart rate** - HR zone boundaries
- **Threshold pace** - pace zone calculations
- **Zone boundaries** - HR zones (5-zone), power zones (Coggan 7-zone), pace zones (5-zone)
- **Unit system** - metric or imperial

Loading priority: DB values → model defaults.

---
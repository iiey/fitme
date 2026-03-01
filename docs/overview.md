# FitMe - Architecture Insights

> Architecture, data flow, and the performance strategy behind the dashboard.

---

## 1. Overview

FitMe is a self-hosted, single-user statistics dashboard for training data. It
ingests **Strava and Garmin bulk exports** and supports **live sync via
Intervals.icu**, producing interactive analytics across eight pages: Dashboard,
Fitness, Activities, Calendar, Goals, Heatmap, Milestones, and Rewind. An optional
**FitBuddy** AI coach ships as a self-contained plugin (see [doc/coach.md][doc-coach-md]).

| Layer | Stack |
|-------|-------|
| **Backend** | Python 3.12, FastAPI, SQLAlchemy 2, SQLite (WAL), Alembic, Pydantic 2 |
| **Frontend** | Next.js 15 (App Router), React 19, TypeScript 5.7, Tailwind 3.4, ECharts 5.6, Leaflet, SWR 2.3, Zod |
| **Infra** | Docker Compose (2 services), uv, standalone Next.js output, GitHub Actions CI |

---

## 2. Architecture

```
Browser → Next.js (:3000) → FastAPI (:8000) → SQLite (WAL)
            rewrites /api/*   one router per     single file,
            to the backend    feature            zero-config
```

Next.js rewrites `/api/*` to the backend so the browser talks to one origin; data
fetching uses SWR with Zod-validated wrappers.

```
fitme/
├── backend/
│   └── app/
│       ├── api/          # REST routers, one per feature page
│       ├── domain/       # Stateless business logic (eddington, training_load, stats, rewind, vo2max, dedup, ...)
│       ├── ingestion/    # Import pipeline: Strava/Garmin readers + FIT/GPX/TCX parsers
│       ├── coach/        # FitBuddy AI coach plugin (optional; own coach.db)
│       ├── models.py     # SQLAlchemy models (10 tables)
│       ├── repository.py # Data access layer
│       └── main.py       # FastAPI entry
├── frontend/
│   ├── app/              # App Router pages (one per feature) + settings
│   ├── components/       # activities, charts, map, import, coach, ui
│   └── lib/              # SWR hooks + Zod schemas, formatting, ECharts setup
└── docker-compose.yml
```

---

## 3. Data Model

Ten tables, scoped per athlete; see [doc/database.md][doc-database-md] for the full
schema.

| Table | Primary Key | Purpose |
|-------|-------------|---------|
| `activity` | `activity_id` | Core activity record - distance, time, elevation, HR, power, sport, gear, polyline, user note |
| `activity_stream` | `(activity_id, stream_type)` | Time-series (HR, watts, speed, altitude, ...) as zlib-compressed JSON blobs |
| `best_effort` | `(activity_id, distance_m)` | Fastest time over standard distances (400 m, 1 km, 5 km, ...) |
| `gear` | `gear_id` | Bikes / shoes with accumulated distance |
| `goal` | auto-increment | Training targets over flexible date ranges; progress computed at query time |
| `goal_sport` | `(goal_id, sport_type)` | Sports a goal counts toward (empty = all); SQL FK to `goal`, cascade |
| `sync_config` | `provider` | Credentials + watermark for Intervals.icu sync |
| `import_run` | auto-increment | Import audit trail (timestamp, source, counts) |
| `athlete_profile` | `athlete_id` | Athlete identity + training parameters (FTP, HR, weight, zones, units) |
| `source_identity` | `(source, source_athlete_id)` | Maps a provider's athlete ID to the canonical `athlete_id` |

Activity streams use a custom `CompressedJSON` type that zlib-compresses the JSON on
write and decompresses on read - roughly 70-80% smaller than raw JSON.

---

## 4. Import Pipeline

The importer accepts a **Strava** or **Garmin** bulk export (zip or folder; Garmin
ships FIT files with embedded metadata, no CSV). For each activity row it hashes the
row (SHA1) for idempotency, parses the FIT/GPX/TCX for streams and route,
RDP-downsamples the polyline, computes best efforts, and stores the result; it then
upserts the athlete profile and records an `import_run`.

- **Idempotent** - same `source_hash` skips, a changed one updates (recreating
  streams/best-efforts), a new id inserts.
- **Background** - uploads run on a `ThreadPoolExecutor` thread; the API returns an
  import id the client polls.

---

## 5. Continuous Sync (Intervals.icu)

Beyond bulk imports, FitMe incrementally syncs from the
[Intervals.icu REST API][intervals-icu-rest-api] - a free platform that aggregates
Garmin/Strava/uploads, an ideal intermediary when those providers' own APIs are paid.
Authentication is HTTP Basic (`API_KEY` as the username, the personal key as the
password). Credentials and the toggle live in `sync_config`, managed from Settings.

- **Incremental** - fetches only activities after a stored watermark, with a 7-day
  overlap buffer for late or edited activities.
- **Idempotent & cross-source safe** - a SHA1 of stable fields skips unchanged
  activities; synced rows are deduplicated against existing Strava/Garmin twins
  (tolerant match: 3 min start, 250 m / 5% distance).
- **Hybrid fetch** - prefers the original file (FIT/GPX/TCX) for full streams, falls
  back to the streams API when unavailable.
- **Non-blocking** - a daemon thread under the same lock as bulk imports; the UI
  polls `GET /api/sync/status`.
- **Auto sync** - one run on the first app start each day (gated by
  `sync_config.last_auto_sync_on`), only when configured and enabled; failures are
  logged and never block startup. Toggle with `FITME_STARTUP_SYNC_ENABLED`.

---

## 6. API Layer

All endpoints live under `/api/`, proxied through Next.js rewrites. Stable read
endpoints return `Cache-Control: public, max-age=300` (the meta endpoint uses a
shorter TTL since it reflects import state).

| Group | Endpoints |
|-------|-----------|
| Read pages | `GET /api/{meta, dashboard, calendar/{y}/{m}, eddington, milestones, rewind/{year}}` |
| Activities | `GET /api/activities[/{id}]`, `PUT /api/activities/{id}/note` |
| Athletes | `GET /api/athletes`, `DELETE /api/athletes/{id}`, `GET\|PUT /api/athletes/config` |
| Goals | `GET\|POST /api/goals`, `GET /api/goals/progress`, `PUT\|DELETE /api/goals/{id}` |
| Heatmap | `GET /api/heatmap/routes` (paginated polylines) |
| Import | `POST /api/import[/upload\|/preview]`, `GET /api/import/runs[/{id}]` |
| Sync | `GET\|PUT\|DELETE /api/sync/config`, `GET /api/sync/status`, `POST /api/sync/trigger` |
| Health | `GET /health` |

---

## 7. Dashboard Computation

The dashboard endpoint is the heaviest. It SQL-filters the athlete's activities,
batch-loads only the streams each section needs (the recent window for HR zones and
peak power, all runs for VO2max), then computes every section sequentially - they are
pure-Python and CPU-bound, so a thread pool only adds GIL overhead.

| Optimization | What it does |
|--------------|--------------|
| **SQL-level filtering** | Sport/year/date filters are pushed into `WHERE` clauses, not applied in Python |
| **Scoped stream loading** | Streams are batch-loaded in one query, only for the activities a section reads |
| **Eddington LRU cache** | `compute_eddington()` is cached (`@lru_cache`) keyed on an MD5 of its input |
| **Sequential sections** | Sections run inline; a thread pool profiled ~24% slower for this pure-Python work |
| **Compressed streams** | Stream BLOBs use zlib compression (~70-80% reduction) |

---

## 8. Frontend Architecture

- **Data fetching** - SWR hooks in `lib/api.ts` for reads, standalone async functions
  for writes; every response is Zod-validated before reaching a component (a second
  boundary on top of the backend's Pydantic models).
- **Performance** - below-fold sections mount via `IntersectionObserver` (with
  skeleton placeholders); ECharts is tree-shaken (bar/line/pie only); polylines are
  RDP-downsampled; list pagination/filters persist in the URL.
- **Sport-oriented detail** - the activity page renders by **sport profile**, not raw
  data presence: a registry ([activityProfiles.ts][frontend-lib-activityprofiles-ts])
  maps each activity type to the appropriate tiles and sections, and
  [components/activities/][components-activities] renders one only when the profile
  allows it **and** the data exists (so a yoga session shows no pace header). Charts
  plot over distance for distance-based sports, else over elapsed time.
- **Dark mode** - Tailwind's `class` strategy with CSS variables; light/dark/system,
  persisted to `localStorage`.

---

## 9. Infrastructure

- **Docker Compose** - two services: `backend` (`python:3.12-slim` + uv, runs Alembic
  migrations on startup) and `frontend` (`node:22-slim`, standalone Next.js output,
  rewrites `/api/*` to the backend).
- **SQLite** - WAL + `synchronous=NORMAL`, `busy_timeout=5000`, and `foreign_keys=ON`,
  set per connection; single file, Alembic-managed.
- **CI (GitHub Actions)** - three parallel jobs: backend (ruff + pytest), frontend
  (lint + tsc), docker (build only, no push).

---

## 10. Configuration

Backend env vars use the `FITME_` prefix (documented in `.env.example`):
`FITME_DATABASE_URL`, `FITME_CORS_ORIGINS`, and the frontend-side `BACKEND_URL` for
API proxying.

Athlete training parameters live on `athlete_profile`, editable in Settings -
birthday/sex (age-based max-HR fallback), weight (W/kg), FTP (power zones),
max/resting HR (HR zones), threshold pace (pace zones), zone boundaries, and unit
system. DB values take precedence over model defaults.

---

## 11. FitBuddy (AI Coach)

An optional, self-contained AI coaching plugin the core never depends on: gated on the
`pydantic-ai` extra, mounted from a single guarded block in [main.py][backend-app-main-py],
with its own `coach.db`. A Pydantic AI agent answers from the athlete's real data via
read-only tools, with a choice of Ollama, OpenAI, or Anthropic. See
[doc/coach.md][doc-coach-md] for the full design.

<!-- Reference links -->
[backend-app-main-py]: backend/app/main.py
[components-activities]: frontend/components/activities/
[doc-coach-md]: doc/coach.md
[doc-database-md]: doc/database.md
[frontend-lib-activityprofiles-ts]: frontend/lib/activityProfiles.ts
[intervals-icu-rest-api]: https://intervals.icu/api/v1/docs/swagger-ui/index.html

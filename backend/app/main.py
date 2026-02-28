from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import Response

from app.config import settings
from app.db import init_db

logging.basicConfig(level=logging.INFO)


@asynccontextmanager
async def lifespan(app: FastAPI):
    if settings.auto_create_tables:
        init_db()
    if settings.startup_sync_enabled:
        # Kick off the once-per-day Intervals.icu sync. Imported lazily (like the
        # routers below) to keep the module import graph shallow. A no-op when
        # sync is unconfigured/disabled or already ran today.
        from app.api.sync import maybe_start_daily_sync

        maybe_start_daily_sync()
    yield


_CACHEABLE_PREFIXES = (
    "/api/dashboard",
    "/api/eddington",
    "/api/milestones",
    "/api/rewind",
    "/api/heatmap",
    "/api/calendar",
)
_CACHE_MAX_AGE = 300


class CacheControlMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next) -> Response:
        response = await call_next(request)
        if (
            request.method == "GET"
            and response.status_code == 200
            and request.url.path.startswith(_CACHEABLE_PREFIXES)
        ):
            # private: these responses are athlete-scoped, so only the browser
            # may cache them - never a shared/proxy cache that could serve one
            # athlete's data to another.
            response.headers.setdefault("Cache-Control", f"private, max-age={_CACHE_MAX_AGE}")
        return response


def create_app() -> FastAPI:
    app = FastAPI(
        title=settings.app_name,
        description=settings.app_subtitle,
        version="0.1.0",
        lifespan=lifespan,
    )

    app.add_middleware(CacheControlMiddleware)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # Routers are imported lazily to keep the module import graph shallow.
    from app.api import (
        activities,
        athletes,
        calendar,
        dashboard,
        eddington,
        goals,
        heatmap,
        imports,
        meta,
        milestones,
        rewind,
        sync,
    )

    app.include_router(meta.router)
    app.include_router(athletes.router)
    app.include_router(imports.router)
    app.include_router(activities.router)
    app.include_router(goals.router)
    app.include_router(dashboard.router)
    app.include_router(calendar.router)
    app.include_router(eddington.router)
    app.include_router(heatmap.router)
    app.include_router(milestones.router)
    app.include_router(rewind.router)
    app.include_router(sync.router)

    # Optional FitBuddy plugin (backend/app/coach). Imported and mounted behind a
    # guard so a missing optional dependency (pydantic-ai) leaves the app running
    # normally without the feature. This is the only core touch point.
    try:
        from app.coach import register_coach

        register_coach(app)
    except ImportError as exc:
        logging.getLogger("fitme.coach").info("FitBuddy feature not available (%s); skipping.", exc)

    @app.get("/health", tags=["meta"])
    def health() -> dict[str, str]:
        return {"status": "ok"}

    return app


app = create_app()

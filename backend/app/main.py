from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.db import init_db

logging.basicConfig(level=logging.INFO)


@asynccontextmanager
async def lifespan(app: FastAPI):
    if settings.auto_create_tables:
        init_db()
    yield


def create_app() -> FastAPI:
    app = FastAPI(
        title=settings.app_name,
        description=settings.app_subtitle,
        version="0.1.0",
        lifespan=lifespan,
    )

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
        calendar,
        dashboard,
        eddington,
        heatmap,
        imports,
        meta,
        milestones,
        rewind,
    )

    app.include_router(meta.router)
    app.include_router(imports.router)
    app.include_router(activities.router)
    app.include_router(dashboard.router)
    app.include_router(calendar.router)
    app.include_router(eddington.router)
    app.include_router(heatmap.router)
    app.include_router(milestones.router)
    app.include_router(rewind.router)

    @app.get("/health", tags=["meta"])
    def health() -> dict[str, str]:
        return {"status": "ok"}

    return app


app = create_app()

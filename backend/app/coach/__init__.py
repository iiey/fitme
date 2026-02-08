from __future__ import annotations

from fastapi import FastAPI


def register_coach(app: FastAPI) -> None:
    """Mount the FitBuddy feature: create its tables and include its router.

    Called behind a try/except in app.main. The pydantic-ai-dependent modules
    are imported here (not at module top), so when the optional dependency is
    absent the import fails and the caller simply runs without the coach.
    """
    # Gate the whole feature on the optional dependency: if pydantic-ai is not
    # installed this raises ImportError and app.main skips registration, so the
    # app runs without any coach routes (and the UI hides itself).
    import pydantic_ai  # noqa: F401

    from app.coach.db import create_tables
    from app.coach.router import router

    create_tables()
    app.include_router(router)

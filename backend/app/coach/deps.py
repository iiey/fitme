from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy.orm import Session

from app.athlete import AthleteConfig


@dataclass
class CoachView:
    """What the user is currently looking at, derived from the route by the UI."""

    view: str | None = None
    activity_id: str | None = None


@dataclass
class CoachDeps:
    """Dependencies injected into the agent and its tools for one chat turn.

    ``core_db`` is a session on the main fitme database (read-only use by tools);
    the coach's own tables are written separately via the coach session in the
    service layer, so a single run never mixes the two databases in one tool.
    """

    core_db: Session
    athlete_id: str
    athlete: AthleteConfig
    view: CoachView

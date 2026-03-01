from __future__ import annotations

import threading
from dataclasses import dataclass, field

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

    ``core_db`` is read by the function tools (the main fitme database); ``coach_db`` is
    where the ``remember`` tool writes long-term memory. ``memory`` is the
    athlete's stored facts, loaded once and injected into the instructions.
    """

    core_db: Session
    coach_db: Session
    athlete_id: str
    athlete: AthleteConfig
    view: CoachView
    # Serializes DB access from the function tools. Pydantic AI runs sync tools
    # in worker threads and may dispatch several from a single model turn
    # concurrently; the two shared Sessions (and their SQLite connections) are
    # not thread-safe, so tools hold this lock while touching the database.
    db_lock: threading.Lock = field(default_factory=threading.Lock, repr=False, compare=False)
    memory: list[str] = field(default_factory=list)
    session_id: int | None = None
    # Resolved instructions for a skill picked from the chat "/" menu, injected
    # into the agent for this message only (None when no skill is active).
    skill_name: str | None = None
    skill_instructions: str | None = None
    # Whether the athlete enabled the web toggle for this message. Gates both the
    # web toolset (added at run time) and the web-usage guidance in instructions.
    web_search: bool = False

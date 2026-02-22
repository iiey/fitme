from __future__ import annotations

from datetime import datetime

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.coach.models import CoachConfig, CoachMemory, CoachMessage, CoachSession

# Titles are derived from the first user message, trimmed to this length.
_TITLE_MAX_LEN = 48


def create_session(db: Session, athlete_id: str, title: str = "New chat") -> CoachSession:
    session = CoachSession(athlete_id=athlete_id, title=title)
    db.add(session)
    db.commit()
    db.refresh(session)
    return session


def list_sessions(db: Session, athlete_id: str) -> list[CoachSession]:
    stmt = (
        select(CoachSession)
        .where(CoachSession.athlete_id == athlete_id)
        .order_by(CoachSession.updated_on.desc())
    )
    return list(db.execute(stmt).scalars().all())


def get_session(db: Session, session_id: int, athlete_id: str) -> CoachSession | None:
    session = db.get(CoachSession, session_id)
    if session is None or session.athlete_id != athlete_id:
        return None
    return session


def rename_session(
    db: Session, session_id: int, athlete_id: str, title: str
) -> CoachSession | None:
    session = get_session(db, session_id, athlete_id)
    if session is None:
        return None
    session.title = title.strip() or session.title
    db.commit()
    db.refresh(session)
    return session


def delete_session(db: Session, session_id: int, athlete_id: str) -> bool:
    session = get_session(db, session_id, athlete_id)
    if session is None:
        return False
    # Delete messages explicitly so the result does not depend on the SQLite
    # foreign-key cascade being enabled.
    db.execute(delete(CoachMessage).where(CoachMessage.session_id == session_id))
    db.delete(session)
    db.commit()
    return True


def delete_sessions(db: Session, session_ids: list[int], athlete_id: str) -> int:
    """Delete several sessions (and their messages) owned by the athlete.

    Returns the number actually removed; ids that are missing or owned by a
    different athlete are skipped, so the batch is best-effort. Backs the chat
    list's multi-select delete and "Clear all" actions.
    """
    if not session_ids:
        return 0
    owned = list(
        db.execute(
            select(CoachSession.id)
            .where(CoachSession.athlete_id == athlete_id)
            .where(CoachSession.id.in_(session_ids))
        )
        .scalars()
        .all()
    )
    if not owned:
        return 0
    # Remove messages first so no rows are orphaned regardless of cascade.
    db.execute(delete(CoachMessage).where(CoachMessage.session_id.in_(owned)))
    db.execute(delete(CoachSession).where(CoachSession.id.in_(owned)))
    db.commit()
    return len(owned)


def list_messages(db: Session, session_id: int) -> list[CoachMessage]:
    stmt = (
        select(CoachMessage)
        .where(CoachMessage.session_id == session_id)
        .order_by(CoachMessage.id.asc())
    )
    return list(db.execute(stmt).scalars().all())


def add_message(db: Session, session_id: int, role: str, content: str) -> CoachMessage:
    message = CoachMessage(session_id=session_id, role=role, content=content)
    db.add(message)
    # Bump the session so it sorts to the top of the recents list.
    session = db.get(CoachSession, session_id)
    if session is not None:
        session.updated_on = datetime.utcnow()
    db.commit()
    db.refresh(message)
    return message


# -- Long-term memory -------------------------------------------------------


def add_memory(
    db: Session, athlete_id: str, content: str, source_session_id: int | None = None
) -> CoachMemory:
    # Skip near-duplicate facts (case-insensitive) so memory does not accumulate
    # the same thing across turns.
    normalized = content.strip().casefold()
    for existing in list_memory(db, athlete_id):
        if existing.content.strip().casefold() == normalized:
            return existing
    memory = CoachMemory(
        athlete_id=athlete_id, content=content.strip(), source_session_id=source_session_id
    )
    db.add(memory)
    db.commit()
    db.refresh(memory)
    return memory


def list_memory(db: Session, athlete_id: str) -> list[CoachMemory]:
    stmt = (
        select(CoachMemory)
        .where(CoachMemory.athlete_id == athlete_id)
        .order_by(CoachMemory.id.asc())
    )
    return list(db.execute(stmt).scalars().all())


def delete_memory(db: Session, memory_id: int, athlete_id: str) -> bool:
    memory = db.get(CoachMemory, memory_id)
    if memory is None or memory.athlete_id != athlete_id:
        return False
    db.delete(memory)
    db.commit()
    return True


def reset_all(db: Session) -> None:
    """Wipe every coach table: config, sessions, messages, and memory.

    Backs the "Reset All" action. Messages are removed first so no rows are
    orphaned regardless of cascade settings.
    """
    db.execute(delete(CoachMessage))
    db.execute(delete(CoachSession))
    db.execute(delete(CoachMemory))
    db.execute(delete(CoachConfig))
    db.commit()


def title_from_message(message: str) -> str:
    """A short session title derived from the first user message."""
    text = " ".join(message.split())
    if len(text) <= _TITLE_MAX_LEN:
        return text or "New chat"
    return text[:_TITLE_MAX_LEN].rstrip() + "…"

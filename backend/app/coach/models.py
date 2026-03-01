from __future__ import annotations

from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.coach.config import CONFIG_ID
from app.coach.db import CoachBase
from app.timeutil import utcnow


class CoachConfig(CoachBase):
    """Single-row LLM provider configuration for the FitBuddy.

    Modeled on the core SyncConfig: the API key is write-only in API responses
    (redacted to has_api_key), and last_status/last_message hold the most recent
    connectivity check so the UI can gate the launcher on a verified config.
    """

    __tablename__ = "coach_config"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=CONFIG_ID)
    provider: Mapped[str] = mapped_column(String, nullable=False)
    model: Mapped[str] = mapped_column(String, nullable=False)
    # Optional: local providers (Ollama) need no key.
    api_key: Mapped[str | None] = mapped_column(String, nullable=True)
    # Optional: base URL for Ollama / OpenAI-compatible endpoints.
    base_url: Mapped[str | None] = mapped_column(String, nullable=True)
    enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    # Result of the last verification ("ok" | "error" | None).
    last_status: Mapped[str | None] = mapped_column(String, nullable=True)
    last_message: Mapped[str | None] = mapped_column(String, nullable=True)
    updated_on: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)


class CoachSession(CoachBase):
    """A single chat conversation, scoped to one athlete. Renameable and deletable."""

    __tablename__ = "coach_session"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    athlete_id: Mapped[str] = mapped_column(String, index=True, nullable=False)
    title: Mapped[str] = mapped_column(String, default="New chat")
    created_on: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_on: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)


class CoachMessage(CoachBase):
    """One turn in a chat session. Deleted with its session (cascade)."""

    __tablename__ = "coach_message"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    session_id: Mapped[int] = mapped_column(
        ForeignKey("coach_session.id", ondelete="CASCADE"), index=True, nullable=False
    )
    # "user" or "assistant".
    role: Mapped[str] = mapped_column(String, nullable=False)
    content: Mapped[str] = mapped_column(Text, default="")
    created_on: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class CoachMemory(CoachBase):
    """A durable fact about an athlete that the coach recalls across sessions."""

    __tablename__ = "coach_memory"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    athlete_id: Mapped[str] = mapped_column(String, index=True, nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    # Provenance only (no FK, so deleting a session never removes memory).
    source_session_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_on: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

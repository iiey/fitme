from __future__ import annotations

from datetime import datetime

from sqlalchemy import Boolean, DateTime, String
from sqlalchemy.orm import Mapped, mapped_column

from app.coach.config import CONFIG_ID
from app.coach.db import CoachBase


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
    updated_on: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow
    )

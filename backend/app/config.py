from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

# Project root is the backend/ directory.
BACKEND_ROOT = Path(__file__).resolve().parent.parent
STORAGE_DIR = BACKEND_ROOT / "storage"


class Settings(BaseSettings):
    """Application configuration, overridable via environment variables.

    All variables are prefixed with ``STRASTAT_`` (e.g. ``STRASTAT_DATABASE_URL``).
    """

    model_config = SettingsConfigDict(
        env_prefix="STRASTAT_",
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    app_name: str = "StraStat"
    app_subtitle: str = "Statistics for your Strava data"

    # Database (SQLite by default; single-user self-hosted).
    database_url: str = f"sqlite:///{STORAGE_DIR / 'strastat.db'}"

    # Storage locations.
    storage_dir: Path = STORAGE_DIR
    athlete_config_path: Path = BACKEND_ROOT / "config" / "athlete.yaml"

    # CORS - the Next.js dev server origin(s).
    cors_origins: list[str] = [
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ]

    # Create tables automatically on startup (dev convenience; Alembic is the
    # source of truth for production schema management).
    auto_create_tables: bool = True


@lru_cache
def get_settings() -> Settings:
    settings = Settings()
    settings.storage_dir.mkdir(parents=True, exist_ok=True)
    return settings


settings = get_settings()

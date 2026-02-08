from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel


class CoachConfigRequest(BaseModel):
    provider: str
    model: str
    # Blank on update means "keep the stored key" (mirrors the sync config).
    api_key: str = ""
    base_url: str | None = None
    enabled: bool = True


class CoachConfigResponse(BaseModel):
    provider: str
    model: str
    has_api_key: bool
    base_url: str | None
    enabled: bool
    last_status: str | None
    last_message: str | None
    updated_on: datetime | None = None


class CoachVerifyRequest(BaseModel):
    """Settings to test. Any field left unset falls back to the stored config."""

    provider: str | None = None
    model: str | None = None
    api_key: str = ""
    base_url: str | None = None


class CoachVerifyResult(BaseModel):
    ok: bool
    message: str


class CoachStatusResponse(BaseModel):
    configured: bool
    enabled: bool
    # usable = configured and enabled and the last verification succeeded.
    # The frontend shows the coach launcher only when this is true.
    usable: bool
    provider: str | None = None
    model: str | None = None
    last_status: str | None = None
    last_message: str | None = None

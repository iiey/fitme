from __future__ import annotations

import logging

from app.coach.models import CoachConfig
from app.coach.provider import InvalidCoachConfig, build_model

logger = logging.getLogger("fitme.coach")

# A tiny prompt keeps the connectivity check cheap across providers.
_PING_PROMPT = "Reply with the single word: OK"

# Local providers (Ollama) may cold-load a multi-GB model on the first call,
# which can take far longer than a warm cloud request. The cap only exists to
# stop a truly stalled/unreachable provider from hanging the UI indefinitely,
# so it is generous enough to let a large local model finish loading.
_VERIFY_TIMEOUT_SECONDS = 60

# Reasoning models spend output tokens on hidden reasoning, so too small a cap
# can yield empty content. A modest budget keeps the ping cheap while leaving
# room for a real reply.
_VERIFY_MAX_TOKENS = 32


async def verify_connection(config: CoachConfig) -> tuple[bool, str]:
    """Make a minimal model call to confirm the provider is reachable.

    Returns (ok, message). Never raises: configuration and provider errors are
    converted into a human-readable message for the UI to display.
    """
    try:
        model = build_model(config)
    except InvalidCoachConfig as exc:
        return False, str(exc)

    try:
        from pydantic_ai import Agent

        agent = Agent(model)
        # Cap the request so a stalled or unreachable provider cannot hang the UI.
        await agent.run(
            _PING_PROMPT,
            model_settings={
                "max_tokens": _VERIFY_MAX_TOKENS,
                "timeout": _VERIFY_TIMEOUT_SECONDS,
            },
        )
    except Exception as exc:  # noqa: BLE001 - report any provider error, do not suppress
        logger.info("Coach verify failed: %s", exc)
        return False, _short_error(str(exc))
    return True, "Connection OK"


def _short_error(message: str) -> str:
    """Trim noisy provider tracebacks to a single readable line for the UI.

    Bare connectivity failures (e.g. OpenAI client's "Connection error.") are
    augmented with a hint, since the usual cause is the base URL not being
    reachable from the server process rather than a bad configuration.
    """
    text = message.strip()
    line = text.splitlines()[0] if text else "Unknown error"
    lowered = line.lower()
    if "connection" in lowered or "connect" in lowered or "refused" in lowered:
        line = (
            f"{line} Could not reach the provider. Check the Base URL is correct and "
            "reachable from the server (note: a server in WSL/Docker cannot reach a "
            "model on the Windows/host loopback via localhost)."
        )
    return line[:300]

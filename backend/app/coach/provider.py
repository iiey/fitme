from __future__ import annotations

from typing import TYPE_CHECKING

from app.coach.config import Provider
from app.coach.models import CoachConfig

if TYPE_CHECKING:
    from pydantic_ai.models import Model


class InvalidCoachConfig(ValueError):
    """Raised when the stored coach configuration cannot build a model."""


def _ollama_base_url(base_url: str | None) -> str:
    if not base_url:
        raise InvalidCoachConfig("A base URL is required for Ollama.")
    url = base_url.rstrip("/")
    # Ollama exposes an OpenAI-compatible API under /v1.
    return url if url.endswith("/v1") else f"{url}/v1"


def build_model(config: CoachConfig) -> Model:
    """Build a Pydantic AI model from the stored provider configuration.

    This is the coach's provider factory (analogous to stat-for-stra's
    AIProviderFactory): the single place mapping a provider to a concrete model.
    Imports are local so a missing provider SDK only affects that branch.
    """
    provider = Provider(config.provider)

    if provider is Provider.ANTHROPIC:
        from pydantic_ai.models.anthropic import AnthropicModel
        from pydantic_ai.providers.anthropic import AnthropicProvider

        if not config.api_key:
            raise InvalidCoachConfig("An API key is required for Anthropic.")
        return AnthropicModel(config.model, provider=AnthropicProvider(api_key=config.api_key))

    from pydantic_ai.models.openai import OpenAIChatModel
    from pydantic_ai.providers.openai import OpenAIProvider

    if provider is Provider.OPENAI:
        if not config.api_key:
            raise InvalidCoachConfig("An API key is required for OpenAI.")
        return OpenAIChatModel(config.model, provider=OpenAIProvider(api_key=config.api_key))

    # Ollama / OpenAI-compatible endpoints: OpenAI client with a custom base URL.
    # The key is optional (Ollama ignores it, but the client wants a non-empty string).
    if provider is Provider.OLLAMA:
        base_url = _ollama_base_url(config.base_url)
    else:  # OPENAI_COMPATIBLE
        if not config.base_url:
            raise InvalidCoachConfig("A base URL is required for this provider.")
        base_url = config.base_url.rstrip("/")

    return OpenAIChatModel(
        config.model,
        provider=OpenAIProvider(base_url=base_url, api_key=config.api_key or "ollama"),
    )

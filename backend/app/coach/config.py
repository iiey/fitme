from __future__ import annotations

from enum import Enum

# Single-row primary key for the coach configuration table.
CONFIG_ID = "default"


class Provider(str, Enum):
    """LLM providers the FitBuddy can talk to.

    ``ollama`` and ``openai_compatible`` both reach an OpenAI-compatible endpoint
    via a custom base URL; the API key is optional for them.
    """

    OPENAI = "openai"
    ANTHROPIC = "anthropic"
    OLLAMA = "ollama"
    OPENAI_COMPATIBLE = "openai_compatible"


# Providers reached through a base URL where the API key is not required.
LOCAL_PROVIDERS = frozenset({Provider.OLLAMA, Provider.OPENAI_COMPATIBLE})

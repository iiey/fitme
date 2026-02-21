from __future__ import annotations

from pydantic_ai.toolsets import FunctionToolset

# Optional, no-cost web access for FitBuddy. Two key-less tools, enabled per
# message when the athlete turns on the web toggle in the composer:
#   - duckduckgo_search: find current pages for a query (needs the ``ddgs`` pkg).
#   - web_fetch: download one URL and return it as markdown (needs ``markdownify``).
# Both ship with Pydantic AI and are pulled in by the ``coach`` extra. If those
# deps are missing the toolset is simply unavailable and the rest of the coach
# keeps working - mirroring the provider factory's local-import guarding.
try:
    from pydantic_ai.common_tools.duckduckgo import duckduckgo_search_tool
    from pydantic_ai.common_tools.web_fetch import web_fetch_tool

    WEB_TOOLS_AVAILABLE = True
except ImportError:  # ddgs / markdownify not installed
    WEB_TOOLS_AVAILABLE = False

# Bound a single web-enabled turn: a handful of results and a capped page size
# keep latency and token cost predictable.
_MAX_SEARCH_RESULTS = 5
_MAX_FETCH_CHARS = 20_000

# Guidance injected only when the web toggle is on, so the default coach stays
# grounded in the athlete's own data and never wanders onto the web unbidden.
WEB_INSTRUCTIONS = (
    "Web search is enabled for this message. You may use duckduckgo_search to "
    "find current information (events, races, gear, nutrition, general training "
    "science) and web_fetch to read a result page in full when the search "
    "snippet is not enough. Keep using your data tools for anything about the "
    "athlete's own training - the web does not know their numbers. Prefer "
    "reputable sources, and cite the URLs you relied on at the end of the answer."
)


def build_web_toolset() -> FunctionToolset | None:
    """Build the web-search toolset, or ``None`` when the optional deps are absent."""
    if not WEB_TOOLS_AVAILABLE:
        return None
    return FunctionToolset(
        tools=[
            duckduckgo_search_tool(max_results=_MAX_SEARCH_RESULTS),
            web_fetch_tool(max_content_length=_MAX_FETCH_CHARS),
        ]
    )

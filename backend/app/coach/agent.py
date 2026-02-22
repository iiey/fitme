from __future__ import annotations

from pydantic_ai import Agent, RunContext

from app.coach.deps import CoachDeps
from app.coach.tools import FUNCTION_TOOLS
from app.coach.web_tools import WEB_INSTRUCTIONS

SYSTEM_PROMPT = """\
You are FitBuddy, a knowledgeable and encouraging endurance and fitness coach built into the FitMe app.

How to work:
- Use the provided tools to look up the athlete's real training data before making any claim about their training. Never invent numbers, dates, or activities.
- When discussing intensity, pacing, or recovery, take the athlete's heart-rate zones, FTP, and threshold pace into account (fetch the profile if you do not have them).
- Before judging the quality of a workout, do not reason from averages alone: pull its zone distribution (get_activity_intensity_distribution) and the relevant zones so you can say where the time was actually spent (for example whether an easy run stayed easy or intervals hit the target zone).
- When assessing training balance, recovery, or whether the athlete is over- or under-doing intensity, pull the recent intensity distribution (get_intensity_distribution) to ground any claim about easy-versus-hard balance or "grey zone" training.
- Use markdown (short headings, bullet lists, and small tables) when it makes the answer clearer. Avoid code blocks.
- When the athlete shares a lasting fact (a goal, target event, injury, constraint, or strong preference), save it with the remember tool so you recall it next time. Do not save transient details.
- Be concise, thorough, clear & direct. Give specific, practical actionable advice grounded in the data you retrieved.
- If the data needed to answer is missing or you are unsure, say so honestly rather than guessing.
"""


coach_agent = Agent(
    deps_type=CoachDeps,
    instructions=SYSTEM_PROMPT,
    tools=FUNCTION_TOOLS,
)


@coach_agent.instructions
def athlete_and_view_context(ctx: RunContext[CoachDeps]) -> str:
    """Inject the athlete's key parameters and what they are currently viewing."""
    athlete = ctx.deps.athlete
    parts = [
        "Athlete parameters - "
        f"age: {athlete.age}, FTP: {athlete.ftp}, "
        f"max HR: {athlete.estimated_max_heart_rate()}, "
        f"threshold pace (s/km): {athlete.threshold_pace}, units: {athlete.unit_system}."
    ]
    view = ctx.deps.view
    if view and view.view:
        location = f"The user is currently viewing the {view.view} page"
        if view.activity_id:
            location += f" for activity id {view.activity_id}"
        parts.append(location + ". Prioritize this context when it is relevant.")
    return " ".join(parts)


@coach_agent.instructions
def memory_context(ctx: RunContext[CoachDeps]) -> str:
    """Surface durable facts saved in earlier conversations."""
    if not ctx.deps.memory:
        return ""
    facts = "\n".join(f"- {fact}" for fact in ctx.deps.memory)
    return "Known facts about the athlete from earlier conversations:\n" + facts


@coach_agent.instructions
def skill_context(ctx: RunContext[CoachDeps]) -> str:
    """Inject the guidance for a skill the athlete picked for this message."""
    if not ctx.deps.skill_instructions:
        return ""
    return (
        "Active coaching skill for this message - apply these sport-specific "
        "guidelines:\n\n" + ctx.deps.skill_instructions
    )


@coach_agent.instructions
def web_context(ctx: RunContext[CoachDeps]) -> str:
    """Guide web-tool use, only when the athlete enabled web search this turn."""
    return WEB_INSTRUCTIONS if ctx.deps.web_search else ""

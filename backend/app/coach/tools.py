from __future__ import annotations

from pydantic_ai import RunContext

from app.coach import data_access, store
from app.coach.deps import CoachDeps

# Each function below is a "skill": a focused tool the model can call to read one
# aspect of the athlete's real data. Docstrings are sent to the model as the tool
# description, so they are written for the model to read.


def get_recent_activities(ctx: RunContext[CoachDeps], limit: int = 10) -> list[dict]:
    """List the athlete's most recent activities.

    Returns name, date, sport, distance (km), duration (min), elevation,
    average heart rate, average power, and average pace. Use this to ground any
    discussion of recent training. ``limit`` caps the number returned (max 50).
    """
    return data_access.recent_activities(ctx.deps.core_db, ctx.deps.athlete_id, limit)


def get_activity_details(ctx: RunContext[CoachDeps], activity_id: str) -> dict | None:
    """Get detailed metrics for one activity by its id (None if not found).

    Includes max HR/power, normalized power, cadence, calories, description and
    the athlete's note. Prefer this when the user is asking about a specific
    workout (for example the one currently open in the app).
    """
    return data_access.activity_details(ctx.deps.core_db, ctx.deps.athlete_id, activity_id)


def get_training_load(ctx: RunContext[CoachDeps]) -> dict:
    """Get current training load: CTL (fitness), ATL (fatigue), TSB (form).

    Also returns the acute:chronic ratio, monotony, strain, weekly load, rest
    days, and a plain-language status. Use this for readiness, recovery, and
    over/undertraining questions.
    """
    return data_access.training_load_summary(
        ctx.deps.core_db, ctx.deps.athlete_id, ctx.deps.athlete
    )


def get_period_totals(
    ctx: RunContext[CoachDeps], granularity: str = "week", count: int = 8
) -> list[dict]:
    """Get training volume totals per period.

    ``granularity`` is one of "day", "week", "month", "year". Returns the most
    recent ``count`` periods with activity count, distance (km), elevation, and
    duration (hours). Use this for trends in volume over time.
    """
    return data_access.period_totals(ctx.deps.core_db, ctx.deps.athlete_id, granularity, count)


def get_athlete_profile(ctx: RunContext[CoachDeps]) -> dict:
    """Get the athlete's profile and training zones.

    Includes age, weight, FTP, max/resting heart rate, threshold pace, and the
    heart-rate, power, and pace zone boundaries. Use these whenever you discuss
    intensity, zones, or pacing.
    """
    return data_access.athlete_profile(ctx.deps.athlete)


def get_best_efforts(ctx: RunContext[CoachDeps]) -> list[dict]:
    """Get the athlete's fastest times for standard distances, per activity type."""
    return data_access.best_efforts(ctx.deps.core_db, ctx.deps.athlete_id)


def get_goals(ctx: RunContext[CoachDeps]) -> list[dict]:
    """Get the athlete's training goals with current progress toward each target."""
    return data_access.goals(ctx.deps.core_db, ctx.deps.athlete_id)


def remember(ctx: RunContext[CoachDeps], fact: str) -> str:
    """Save a durable fact about the athlete to long-term memory.

    Use this only for lasting facts you should recall in future chats: goals,
    target events and dates, injuries or constraints, equipment, and strong
    training preferences. Do not save transient details or single-workout notes.
    """
    text = fact.strip()
    if not text:
        return "Nothing to remember."
    store.add_memory(ctx.deps.coach_db, ctx.deps.athlete_id, text, ctx.deps.session_id)
    return f"Saved to memory: {text}"


# Registered on the agent in agent.py.
SKILL_TOOLS = [
    get_recent_activities,
    get_activity_details,
    get_training_load,
    get_period_totals,
    get_athlete_profile,
    get_best_efforts,
    get_goals,
    remember,
]

from __future__ import annotations

from datetime import date, datetime, timedelta

from sqlalchemy import delete, func, or_, select
from sqlalchemy.orm import Session

from app.models import Activity, ActivityStream, BestEffort, Gear, Goal


def list_activities(
    db: Session,
    athlete_id: str,
    *,
    sport_types: list[str] | None = None,
    activity_types: list[str] | None = None,
    start: datetime | None = None,
    end: datetime | None = None,
    search: str | None = None,
    name_terms: list[str] | None = None,
    sport_or_name_terms: list[tuple[list[str], str]] | None = None,
    distance_min_m: float | None = None,
    distance_max_m: float | None = None,
    order_by: str = "start_date_time",
    descending: bool = True,
    limit: int | None = None,
    offset: int | None = None,
) -> list[Activity]:
    stmt = select(Activity).where(Activity.athlete_id == athlete_id)
    stmt = _apply_filters(
        stmt,
        sport_types,
        activity_types,
        start,
        end,
        search,
        name_terms,
        sport_or_name_terms=sport_or_name_terms,
        distance_min_m=distance_min_m,
        distance_max_m=distance_max_m,
    )

    sort_column = getattr(Activity, order_by, Activity.start_date_time)
    # activity_id breaks ties so LIMIT/OFFSET paging is deterministic even when
    # the sort column has duplicates or NULLs (e.g. average_heart_rate).
    stmt = stmt.order_by(
        sort_column.desc() if descending else sort_column.asc(),
        Activity.activity_id.asc(),
    )

    if offset is not None:
        stmt = stmt.offset(offset)
    if limit is not None:
        stmt = stmt.limit(limit)
    return list(db.execute(stmt).scalars().all())


def count_activities(
    db: Session,
    athlete_id: str,
    *,
    sport_types: list[str] | None = None,
    activity_types: list[str] | None = None,
    start: datetime | None = None,
    end: datetime | None = None,
    search: str | None = None,
    name_terms: list[str] | None = None,
    sport_or_name_terms: list[tuple[list[str], str]] | None = None,
    distance_min_m: float | None = None,
    distance_max_m: float | None = None,
) -> int:
    stmt = select(func.count()).select_from(Activity).where(Activity.athlete_id == athlete_id)
    stmt = _apply_filters(
        stmt,
        sport_types,
        activity_types,
        start,
        end,
        search,
        name_terms,
        sport_or_name_terms=sport_or_name_terms,
        distance_min_m=distance_min_m,
        distance_max_m=distance_max_m,
    )
    return db.execute(stmt).scalar_one()


def all_activities(db: Session, athlete_id: str) -> list[Activity]:
    return list(
        db.execute(
            select(Activity)
            .where(Activity.athlete_id == athlete_id)
            .order_by(Activity.start_date_time.asc())
        )
        .scalars()
        .all()
    )


def get_activity(db: Session, athlete_id: str, activity_id: str) -> Activity | None:
    activity = db.get(Activity, activity_id)
    if activity is not None and activity.athlete_id != athlete_id:
        return None
    return activity


def streams_for_activity(db: Session, activity_id: str) -> dict[str, list]:
    rows = (
        db.execute(select(ActivityStream).where(ActivityStream.activity_id == activity_id))
        .scalars()
        .all()
    )
    return {row.stream_type: row.data for row in rows}


def streams_for_activities(
    db: Session,
    activity_ids: list[str],
    stream_types: list[str] | None = None,
) -> dict[str, dict[str, list]]:
    """Batch-load streams for multiple activities, avoiding N+1 queries."""
    if not activity_ids:
        return {}
    stmt = select(ActivityStream).where(ActivityStream.activity_id.in_(activity_ids))
    if stream_types:
        stmt = stmt.where(ActivityStream.stream_type.in_(stream_types))
    rows = db.execute(stmt).scalars().all()
    result: dict[str, dict[str, list]] = {}
    for row in rows:
        result.setdefault(row.activity_id, {})[row.stream_type] = row.data
    return result


def heatmap_routes(
    db: Session,
    athlete_id: str,
    *,
    sport_types: list[str] | None = None,
    activity_types: list[str] | None = None,
    start: datetime | None = None,
    end: datetime | None = None,
    commute: bool | None = None,
    limit: int,
    offset: int,
) -> tuple[list[Activity], int, int]:
    """Polyline activities matching the heatmap filters, paginated in SQL.

    Returns ``(page, total, country_count)`` where ``total`` is the full match
    count and ``country_count`` is the number of distinct countries across the
    whole filtered set (not just the returned page).
    """
    conds = [Activity.athlete_id == athlete_id, Activity.polyline.is_not(None)]
    if sport_types:
        conds.append(Activity.sport_type.in_(sport_types))
    if activity_types:
        conds.append(Activity.activity_type.in_(activity_types))
    if start is not None:
        conds.append(Activity.start_date_time >= start)
    if end is not None:
        conds.append(Activity.start_date_time <= end)
    if commute is not None:
        conds.append(Activity.is_commute == commute)

    total = db.execute(select(func.count()).select_from(Activity).where(*conds)).scalar_one()
    country_count = db.execute(
        select(func.count(func.distinct(Activity.country_code))).where(
            *conds, Activity.country_code.is_not(None)
        )
    ).scalar_one()
    page = list(
        db.execute(
            select(Activity)
            .where(*conds)
            .order_by(Activity.start_date_time.asc(), Activity.activity_id.asc())
            .limit(limit)
            .offset(offset)
        )
        .scalars()
        .all()
    )
    return page, total, country_count


def best_efforts_for_activity_types(
    db: Session, athlete_id: str, activity_type: str
) -> list[BestEffort]:
    stmt = (
        select(BestEffort)
        .join(Activity, BestEffort.activity_id == Activity.activity_id)
        .where(Activity.athlete_id == athlete_id, BestEffort.activity_type == activity_type)
    )
    return list(db.execute(stmt).scalars().all())


def best_efforts_for_athlete(db: Session, athlete_id: str) -> list[BestEffort]:
    """All best-effort records for an athlete (across every activity type)."""
    stmt = (
        select(BestEffort)
        .join(Activity, BestEffort.activity_id == Activity.activity_id)
        .where(Activity.athlete_id == athlete_id)
    )
    return list(db.execute(stmt).scalars().all())


def list_gear(db: Session, athlete_id: str) -> list[Gear]:
    return list(
        db.execute(
            select(Gear).where(Gear.athlete_id == athlete_id).order_by(Gear.distance_m.desc())
        )
        .scalars()
        .all()
    )


def distinct_sport_types(db: Session, athlete_id: str) -> list[str]:
    rows = (
        db.execute(select(Activity.sport_type).where(Activity.athlete_id == athlete_id).distinct())
        .scalars()
        .all()
    )
    return sorted(rows)


def distinct_years(db: Session, athlete_id: str) -> list[int]:
    rows = (
        db.execute(
            select(func.distinct(func.strftime("%Y", Activity.start_date_time)))
            .where(Activity.athlete_id == athlete_id)
            .order_by(func.strftime("%Y", Activity.start_date_time).desc())
        )
        .scalars()
        .all()
    )
    return [int(y) for y in rows if y]


def date_range(db: Session, athlete_id: str) -> tuple[datetime | None, datetime | None]:
    row = db.execute(
        select(func.min(Activity.start_date_time), func.max(Activity.start_date_time)).where(
            Activity.athlete_id == athlete_id
        )
    ).one()
    return row[0], row[1]


def update_activity_note(
    db: Session, athlete_id: str, activity_id: str, note: str | None
) -> Activity | None:
    activity = get_activity(db, athlete_id, activity_id)
    if activity is None:
        return None
    activity.user_note = note
    db.commit()
    db.refresh(activity)
    return activity


def delete_activities(db: Session, athlete_id: str, activity_ids: list[str]) -> int:
    """Delete the given activities (and their streams/best efforts) for an athlete.

    Only activities owned by ``athlete_id`` are removed; ids belonging to other
    athletes or already gone are silently skipped. Returns the number deleted.
    """
    if not activity_ids:
        return 0

    owned = list(
        db.execute(
            select(Activity.activity_id).where(
                Activity.athlete_id == athlete_id,
                Activity.activity_id.in_(activity_ids),
            )
        )
        .scalars()
        .all()
    )
    if not owned:
        return 0

    db.execute(delete(ActivityStream).where(ActivityStream.activity_id.in_(owned)))
    db.execute(delete(BestEffort).where(BestEffort.activity_id.in_(owned)))
    db.execute(delete(Activity).where(Activity.activity_id.in_(owned)))
    db.commit()
    return len(owned)


# -- Goals ------------------------------------------------------------------


_METRIC_COLUMNS = {
    "distance_m": Activity.distance_m,
    "elevation_m": Activity.elevation_m,
    "moving_time_s": Activity.moving_time_s,
    "calories": Activity.calories,
}


def list_goals(
    db: Session,
    athlete_id: str,
    *,
    active_on: date | None = None,
) -> list[Goal]:
    stmt = select(Goal).where(Goal.athlete_id == athlete_id)
    if active_on is not None:
        stmt = stmt.where(Goal.start_date <= active_on, Goal.end_date >= active_on)
    stmt = stmt.order_by(Goal.end_date.asc())
    return list(db.execute(stmt).scalars().all())


def get_goal(db: Session, athlete_id: str, goal_id: int) -> Goal | None:
    goal = db.get(Goal, goal_id)
    if goal is not None and goal.athlete_id != athlete_id:
        return None
    return goal


def create_goal(db: Session, goal: Goal) -> Goal:
    db.add(goal)
    db.commit()
    db.refresh(goal)
    return goal


def update_goal(db: Session, goal: Goal) -> Goal:
    db.commit()
    db.refresh(goal)
    return goal


def delete_goal(db: Session, athlete_id: str, goal_id: int) -> bool:
    # Load and delete via the ORM so the ``sports`` relationship cascade removes
    # the goal_sport join rows (a bulk DELETE would bypass that cascade, and
    # SQLite does not enforce the foreign key on its own).
    goal = get_goal(db, athlete_id, goal_id)
    if goal is None:
        return False
    db.delete(goal)
    db.commit()
    return True


def goal_progress(
    db: Session,
    athlete_id: str,
    goal: Goal,
) -> float:
    start_dt = datetime.combine(goal.start_date, datetime.min.time())
    end_dt = datetime.combine(goal.end_date, datetime.max.time())

    base = (
        select(func.count())
        .select_from(Activity)
        .where(
            Activity.athlete_id == athlete_id,
            Activity.start_date_time >= start_dt,
            Activity.start_date_time <= end_dt,
        )
    )
    sport_types = goal.sport_types
    if sport_types:
        base = base.where(Activity.sport_type.in_(sport_types))

    if goal.metric == "count":
        return float(db.execute(base).scalar_one())

    col = _METRIC_COLUMNS.get(goal.metric)
    if col is None:
        return 0.0
    stmt = (
        select(func.coalesce(func.sum(col), 0.0))
        .select_from(Activity)
        .where(
            Activity.athlete_id == athlete_id,
            Activity.start_date_time >= start_dt,
            Activity.start_date_time <= end_dt,
        )
    )
    if sport_types:
        stmt = stmt.where(Activity.sport_type.in_(sport_types))
    return float(db.execute(stmt).scalar_one())


def _apply_filters(
    stmt,
    sport_types,
    activity_types,
    start,
    end,
    search,
    name_terms=None,
    *,
    sport_or_name_terms=None,
    distance_min_m=None,
    distance_max_m=None,
):
    if sport_types:
        stmt = stmt.where(Activity.sport_type.in_(sport_types))
    if activity_types:
        stmt = stmt.where(Activity.activity_type.in_(activity_types))
    if start is not None:
        stmt = stmt.where(Activity.start_date_time >= start)
    if end is not None:
        if end.hour == 0 and end.minute == 0 and end.second == 0:
            stmt = stmt.where(Activity.start_date_time < end + timedelta(days=1))
        else:
            stmt = stmt.where(Activity.start_date_time <= end)
    if distance_min_m is not None:
        stmt = stmt.where(Activity.distance_m >= distance_min_m)
    if distance_max_m is not None:
        stmt = stmt.where(Activity.distance_m <= distance_max_m)
    if search:
        stmt = stmt.where(Activity.name.ilike(f"%{search}%"))
    for term in name_terms or []:
        stmt = stmt.where(Activity.name.ilike(f"%{term}%"))
    for sport_values, token in sport_or_name_terms or []:
        # A typed sport word matches by sport type OR by name, so a trail run
        # logged as a plain "Run" is still found when searching "trail".
        stmt = stmt.where(
            or_(
                Activity.sport_type.in_(sport_values),
                Activity.name.ilike(f"%{token}%"),
            )
        )
    return stmt

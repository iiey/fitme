from __future__ import annotations

from datetime import datetime

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import Activity, ActivityStream, BestEffort, Gear


def list_activities(
    db: Session,
    *,
    sport_types: list[str] | None = None,
    activity_types: list[str] | None = None,
    start: datetime | None = None,
    end: datetime | None = None,
    search: str | None = None,
    name_terms: list[str] | None = None,
    order_by: str = "start_date_time",
    descending: bool = True,
    limit: int | None = None,
    offset: int | None = None,
) -> list[Activity]:
    stmt = select(Activity)
    stmt = _apply_filters(stmt, sport_types, activity_types, start, end, search, name_terms)

    sort_column = getattr(Activity, order_by, Activity.start_date_time)
    stmt = stmt.order_by(sort_column.desc() if descending else sort_column.asc())

    if offset is not None:
        stmt = stmt.offset(offset)
    if limit is not None:
        stmt = stmt.limit(limit)
    return list(db.execute(stmt).scalars().all())


def count_activities(
    db: Session,
    *,
    sport_types: list[str] | None = None,
    activity_types: list[str] | None = None,
    start: datetime | None = None,
    end: datetime | None = None,
    search: str | None = None,
    name_terms: list[str] | None = None,
) -> int:
    stmt = select(func.count()).select_from(Activity)
    stmt = _apply_filters(stmt, sport_types, activity_types, start, end, search, name_terms)
    return db.execute(stmt).scalar_one()


def all_activities(db: Session) -> list[Activity]:
    return list(
        db.execute(select(Activity).order_by(Activity.start_date_time.asc())).scalars().all()
    )


def get_activity(db: Session, activity_id: str) -> Activity | None:
    return db.get(Activity, activity_id)


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


def activities_with_polyline(db: Session) -> list[Activity]:
    stmt = (
        select(Activity)
        .where(Activity.polyline.is_not(None))
        .order_by(Activity.start_date_time.asc())
    )
    return list(db.execute(stmt).scalars().all())


def best_efforts_for_activity_types(db: Session, activity_type: str) -> list[BestEffort]:
    stmt = select(BestEffort).where(BestEffort.activity_type == activity_type)
    return list(db.execute(stmt).scalars().all())


def list_gear(db: Session) -> list[Gear]:
    return list(db.execute(select(Gear).order_by(Gear.distance_m.desc())).scalars().all())


def distinct_sport_types(db: Session) -> list[str]:
    rows = db.execute(select(Activity.sport_type).distinct()).scalars().all()
    return sorted(rows)


def distinct_years(db: Session) -> list[int]:
    rows = (
        db.execute(
            select(func.distinct(func.strftime("%Y", Activity.start_date_time))).order_by(
                func.strftime("%Y", Activity.start_date_time).desc()
            )
        )
        .scalars()
        .all()
    )
    return [int(y) for y in rows if y]


def date_range(db: Session) -> tuple[datetime | None, datetime | None]:
    row = db.execute(
        select(func.min(Activity.start_date_time), func.max(Activity.start_date_time))
    ).one()
    return row[0], row[1]


def _apply_filters(stmt, sport_types, activity_types, start, end, search, name_terms=None):
    if sport_types:
        stmt = stmt.where(Activity.sport_type.in_(sport_types))
    if activity_types:
        stmt = stmt.where(Activity.activity_type.in_(activity_types))
    if start is not None:
        stmt = stmt.where(Activity.start_date_time >= start)
    if end is not None:
        stmt = stmt.where(Activity.start_date_time <= end)
    if search:
        stmt = stmt.where(Activity.name.ilike(f"%{search}%"))
    # Each free-text term must appear in the name (AND), enabling fuzzy queries.
    for term in name_terms or []:
        stmt = stmt.where(Activity.name.ilike(f"%{term}%"))
    return stmt

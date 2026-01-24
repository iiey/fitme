"""add source-aware activity identity (source, external_id, dedup_key)

Revision ID: b7d2c9e1f3a4
Revises: a3c8f1b2e4d5
Create Date: 2026-06-20 09:00:00.000000

"""

import hashlib
from collections.abc import Sequence
from datetime import datetime

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "b7d2c9e1f3a4"
down_revision: str | Sequence[str] | None = "a3c8f1b2e4d5"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_EPOCH = datetime(1970, 1, 1)


def _dedup_key(activity_type, start, distance_m, moving_time_s) -> str | None:
    """Self-contained copy of ``app.domain.dedup.compute_dedup_key``.

    Kept inline so the migration does not depend on (evolving) app code.
    """
    if start is None:
        return None
    if isinstance(start, str):
        try:
            start = datetime.fromisoformat(start)
        except ValueError:
            return None
    minute = int((start - _EPOCH).total_seconds() // 60)
    dist_bucket = int(round((distance_m or 0.0) / 100.0))
    move_bucket = int(round((moving_time_s or 0) / 30.0))
    payload = f"{activity_type}|{minute}|{dist_bucket}|{move_bucket}"
    return hashlib.sha1(payload.encode("utf-8")).hexdigest()


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        "activity",
        sa.Column("source", sa.String(), nullable=False, server_default="strava"),
    )
    op.add_column("activity", sa.Column("external_id", sa.String(), nullable=True))
    op.add_column("activity", sa.Column("dedup_key", sa.String(), nullable=True))

    # Backfill existing rows: they all originate from Strava, so the provider's
    # native id is the current primary key.
    conn = op.get_bind()
    conn.execute(sa.text("UPDATE activity SET external_id = activity_id WHERE external_id IS NULL"))

    rows = conn.execute(
        sa.text(
            "SELECT activity_id, activity_type, start_date_time, distance_m, "
            "moving_time_s FROM activity"
        )
    ).fetchall()
    for activity_id, activity_type, start_dt, distance_m, moving_time_s in rows:
        key = _dedup_key(activity_type, start_dt, distance_m, moving_time_s)
        if key is None:
            continue
        conn.execute(
            sa.text("UPDATE activity SET dedup_key = :k WHERE activity_id = :a"),
            {"k": key, "a": activity_id},
        )

    op.create_index("ix_activity_athlete_dedup", "activity", ["athlete_id", "dedup_key"])
    op.create_index(
        "uq_activity_source_external",
        "activity",
        ["athlete_id", "source", "external_id"],
        unique=True,
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index("uq_activity_source_external", table_name="activity")
    op.drop_index("ix_activity_athlete_dedup", table_name="activity")
    with op.batch_alter_table("activity", schema=None) as batch_op:
        batch_op.drop_column("dedup_key")
        batch_op.drop_column("external_id")
        batch_op.drop_column("source")

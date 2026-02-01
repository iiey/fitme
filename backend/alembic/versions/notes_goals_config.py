"""add activity notes, goal table, and athlete training config

Revision ID: notes_goals_config
Revises: sync_config
Create Date: 2026-06-23 12:00:00.000000

Adds:
- ``user_note`` column on ``activity`` for user-authored notes
- ``goal`` table for flexible-range training goals
- Training parameter columns on ``athlete_profile`` (birthday, weight,
  FTP, HR/power/pace zones, unit system)
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "notes_goals_config"
down_revision: str | Sequence[str] | None = "sync_config"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # -- activity: user_note ---------------------------------------------------
    with op.batch_alter_table("activity", schema=None) as batch_op:
        batch_op.add_column(sa.Column("user_note", sa.String(), nullable=True))

    # -- goal ------------------------------------------------------------------
    op.create_table(
        "goal",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("athlete_id", sa.String(), nullable=False),
        sa.Column("start_date", sa.Date(), nullable=False),
        sa.Column("end_date", sa.Date(), nullable=False),
        sa.Column("sport_type", sa.String(), nullable=True),
        sa.Column("metric", sa.String(), nullable=False),
        sa.Column("target_value", sa.Float(), nullable=False),
        sa.Column("note", sa.String(), nullable=True),
        sa.Column("created_on", sa.DateTime(), nullable=False),
        sa.Column("updated_on", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    with op.batch_alter_table("goal", schema=None) as batch_op:
        batch_op.create_index("ix_goal_athlete_dates", ["athlete_id", "start_date", "end_date"])
        batch_op.create_index(batch_op.f("ix_goal_athlete_id"), ["athlete_id"], unique=False)

    # -- athlete_profile: training parameters ----------------------------------
    with op.batch_alter_table("athlete_profile", schema=None) as batch_op:
        batch_op.add_column(sa.Column("birthday", sa.Date(), nullable=True))
        batch_op.add_column(sa.Column("weight_kg", sa.Float(), nullable=True))
        batch_op.add_column(sa.Column("ftp", sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column("max_heart_rate", sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column("resting_heart_rate", sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column("unit_system", sa.String(), nullable=True))
        batch_op.add_column(sa.Column("threshold_pace", sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column("heart_rate_zones", sa.JSON(), nullable=True))
        batch_op.add_column(sa.Column("power_zones", sa.JSON(), nullable=True))
        batch_op.add_column(sa.Column("pace_zones", sa.JSON(), nullable=True))


def downgrade() -> None:
    # -- athlete_profile -------------------------------------------------------
    with op.batch_alter_table("athlete_profile", schema=None) as batch_op:
        batch_op.drop_column("pace_zones")
        batch_op.drop_column("power_zones")
        batch_op.drop_column("heart_rate_zones")
        batch_op.drop_column("threshold_pace")
        batch_op.drop_column("unit_system")
        batch_op.drop_column("resting_heart_rate")
        batch_op.drop_column("max_heart_rate")
        batch_op.drop_column("ftp")
        batch_op.drop_column("weight_kg")
        batch_op.drop_column("birthday")

    # -- goal ------------------------------------------------------------------
    with op.batch_alter_table("goal", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_goal_athlete_id"))
        batch_op.drop_index("ix_goal_athlete_dates")
    op.drop_table("goal")

    # -- activity --------------------------------------------------------------
    with op.batch_alter_table("activity", schema=None) as batch_op:
        batch_op.drop_column("user_note")

"""add sync_config table

Revision ID: sync_config
Revises: baseline
Create Date: 2026-06-23 10:05:00.000000

Adds the ``sync_config`` table backing continuous Intervals.icu activity sync:
a single configuration-and-state row per provider that binds the sync to a
canonical athlete, stores the personal API key, and persists the sync watermark
and last-run observability.
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "sync_config"
down_revision: str | Sequence[str] | None = "baseline"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create the sync_config table."""
    op.create_table(
        "sync_config",
        sa.Column("provider", sa.String(), nullable=False),
        sa.Column("athlete_id", sa.String(), nullable=False),
        sa.Column("icu_athlete_id", sa.String(), nullable=False),
        sa.Column("api_key", sa.String(), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False),
        sa.Column("synced_through", sa.DateTime(), nullable=True),
        sa.Column("last_run_at", sa.DateTime(), nullable=True),
        sa.Column("last_status", sa.String(), nullable=True),
        sa.Column("last_message", sa.String(), nullable=True),
        sa.Column("created_on", sa.DateTime(), nullable=False),
        sa.Column("updated_on", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("provider"),
    )
    with op.batch_alter_table("sync_config", schema=None) as batch_op:
        batch_op.create_index(batch_op.f("ix_sync_config_athlete_id"), ["athlete_id"], unique=False)


def downgrade() -> None:
    """Drop the sync_config table."""
    with op.batch_alter_table("sync_config", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_sync_config_athlete_id"))

    op.drop_table("sync_config")

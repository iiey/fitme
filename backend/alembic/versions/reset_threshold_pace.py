"""reset cached auto-estimated threshold pace

Revision ID: reset_threshold_pace
Revises: notes_goals_config
Create Date: 2026-06-24 09:00:00.000000

The previous estimator cached its (inaccurate) result in
``athlete_profile.threshold_pace``. It has been replaced with a more accurate
Critical Speed fit over the athlete's best-effort curve, and auto-estimates are
no longer persisted - a NULL value now means "derive automatically". Clear the
stale cached values so the improved estimate takes effect. A genuinely manual
value (re-entered in Settings) overrides the estimate as before.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "reset_threshold_pace"
down_revision: str | Sequence[str] | None = "notes_goals_config"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("UPDATE athlete_profile SET threshold_pace = NULL")


def downgrade() -> None:
    # The cached values were derived data, not user input; nothing to restore.
    pass

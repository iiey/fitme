"""compress activity_stream data column from JSON to zlib BLOB

Revision ID: a3c8f1b2e4d5
Revises: de114c4ab66c
Create Date: 2026-06-17 20:00:00.000000

"""

import json
import zlib
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "a3c8f1b2e4d5"
down_revision: str | None = "de114c4ab66c"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    conn = op.get_bind()

    op.add_column(
        "activity_stream",
        sa.Column("data_compressed", sa.LargeBinary, nullable=True),
    )

    rows = conn.execute(
        sa.text("SELECT activity_id, stream_type, data FROM activity_stream")
    ).fetchall()
    for activity_id, stream_type, data_json in rows:
        if data_json is None:
            continue
        parsed = json.loads(data_json) if isinstance(data_json, str) else data_json
        compressed = zlib.compress(json.dumps(parsed, separators=(",", ":")).encode())
        conn.execute(
            sa.text(
                "UPDATE activity_stream SET data_compressed = :blob "
                "WHERE activity_id = :aid AND stream_type = :st"
            ),
            {"blob": compressed, "aid": activity_id, "st": stream_type},
        )

    with op.batch_alter_table("activity_stream") as batch_op:
        batch_op.drop_column("data")
        batch_op.alter_column("data_compressed", new_column_name="data", nullable=True)


def downgrade() -> None:
    conn = op.get_bind()

    op.add_column(
        "activity_stream",
        sa.Column("data_json", sa.JSON, nullable=True),
    )

    rows = conn.execute(
        sa.text("SELECT activity_id, stream_type, data FROM activity_stream")
    ).fetchall()
    for activity_id, stream_type, data_blob in rows:
        if data_blob is None:
            continue
        parsed = json.loads(zlib.decompress(data_blob))
        conn.execute(
            sa.text(
                "UPDATE activity_stream SET data_json = :val "
                "WHERE activity_id = :aid AND stream_type = :st"
            ),
            {"val": json.dumps(parsed), "aid": activity_id, "st": stream_type},
        )

    with op.batch_alter_table("activity_stream") as batch_op:
        batch_op.drop_column("data")
        batch_op.alter_column("data_json", new_column_name="data", nullable=True)

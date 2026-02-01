from __future__ import annotations

import argparse
import sys

from sqlalchemy import select

from app.db import SessionLocal, init_db
from app.enums import SportType, StreamType
from app.ingestion.importer import import_export


def _cmd_import(args: argparse.Namespace) -> int:
    init_db()
    with SessionLocal() as db:
        summary = import_export(
            db,
            args.source,
            provider=args.provider,
            force=args.force,
            target_athlete_id=args.athlete,
        )
    print(
        "Import complete: "
        f"added={summary.added} updated={summary.updated} skipped={summary.skipped} "
        f"deduped={summary.deduped} gear={summary.gear_upserted} "
        f"files_parsed={summary.files_parsed} parse_errors={summary.parse_errors}"
    )
    return 0


def _cmd_init_db(_: argparse.Namespace) -> int:
    init_db()
    print("Database initialised.")
    return 0


def _cmd_recompute_best_efforts(args: argparse.Namespace) -> int:
    """Rebuild best efforts in place from stored streams.

    Useful after the best-effort computation changes (e.g. GPS-glitch
    rejection): re-derives every activity's best efforts from the streams
    already in the database, without re-importing the original export.
    """
    from app import repository
    from app.ingestion.upsert import replace_best_efforts
    from app.models import Activity

    init_db()
    chunk = 200
    activities_scanned = 0
    activities_updated = 0
    efforts_written = 0

    with SessionLocal() as db:
        stmt = select(Activity)
        if args.athlete:
            stmt = stmt.where(Activity.athlete_id == args.athlete)
        candidates = [
            a
            for a in db.execute(stmt).scalars().all()
            if SportType(a.sport_type).supports_best_efforts
        ]

        stream_types = [StreamType.TIME.value, StreamType.DISTANCE.value]
        for i in range(0, len(candidates), chunk):
            batch = candidates[i : i + chunk]
            streams_by_id = repository.streams_for_activities(
                db, [a.activity_id for a in batch], stream_types
            )
            for activity in batch:
                activities_scanned += 1
                streams = streams_by_id.get(activity.activity_id)
                if not streams:
                    continue
                written = replace_best_efforts(db, activity, streams)
                if written:
                    activities_updated += 1
                    efforts_written += written
            db.commit()

    print(
        "Recompute complete: "
        f"scanned={activities_scanned} updated={activities_updated} "
        f"efforts_written={efforts_written}"
    )
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="fitme", description="FitMe backend CLI")
    sub = parser.add_subparsers(dest="command", required=True)

    import_parser = sub.add_parser("import", help="Import a bulk export (zip or folder)")
    import_parser.add_argument("source", help="Path to export .zip or extracted folder")
    import_parser.add_argument(
        "--provider",
        default=None,
        help="Source provider label (default: auto-detect strava vs garmin)",
    )
    import_parser.add_argument(
        "--athlete",
        default=None,
        help="Merge into this existing athlete id (default: the export's own)",
    )
    import_parser.add_argument(
        "--force",
        action="store_true",
        help="Re-parse and update even unchanged activities",
    )
    import_parser.set_defaults(func=_cmd_import)

    init_parser = sub.add_parser("init-db", help="Create database tables")
    init_parser.set_defaults(func=_cmd_init_db)

    recompute_parser = sub.add_parser(
        "recompute-best-efforts",
        help="Rebuild best efforts from stored streams (e.g. after a fix)",
    )
    recompute_parser.add_argument(
        "--athlete",
        default=None,
        help="Limit to this athlete id (default: all athletes)",
    )
    recompute_parser.set_defaults(func=_cmd_recompute_best_efforts)

    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())

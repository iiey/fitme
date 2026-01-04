from __future__ import annotations

import argparse
import sys

from app.db import SessionLocal, init_db
from app.ingestion.importer import import_export


def _cmd_import(args: argparse.Namespace) -> int:
    init_db()
    with SessionLocal() as db:
        summary = import_export(db, args.source, force=args.force)
    print(
        "Import complete: "
        f"added={summary.added} updated={summary.updated} skipped={summary.skipped} "
        f"gear={summary.gear_upserted} files_parsed={summary.files_parsed} "
        f"parse_errors={summary.parse_errors}"
    )
    return 0


def _cmd_init_db(_: argparse.Namespace) -> int:
    init_db()
    print("Database initialised.")
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="strastat", description="StraStat backend CLI")
    sub = parser.add_subparsers(dest="command", required=True)

    import_parser = sub.add_parser("import", help="Import a Strava bulk export (zip or folder)")
    import_parser.add_argument("source", help="Path to export .zip or extracted folder")
    import_parser.add_argument(
        "--force", action="store_true", help="Re-parse and update even unchanged activities"
    )
    import_parser.set_defaults(func=_cmd_import)

    init_parser = sub.add_parser("init-db", help="Create database tables")
    init_parser.set_defaults(func=_cmd_init_db)

    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())

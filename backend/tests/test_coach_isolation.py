"""Removal-check guard for the AI-coach plugin.

The coach is meant to be a one-way dependency: core backend code may be imported
by the coach, but core must never import ``app.coach`` - except the single
guarded mount in ``app/main.py``. If this test passes, deleting
``backend/app/coach`` (plus the documented frontend drop-ins) cannot break any
core import, which is the backend half of the plug-and-play removal check.
"""

from __future__ import annotations

from pathlib import Path

APP_DIR = Path(__file__).resolve().parents[1] / "app"
# The only core file allowed to reference the plugin (a try/except mount).
ALLOWED = {APP_DIR / "main.py"}


def test_core_does_not_depend_on_coach():
    offenders = []
    for path in APP_DIR.rglob("*.py"):
        if "coach" in path.parts:  # skip the plugin's own package
            continue
        if path in ALLOWED:
            continue
        if "app.coach" in path.read_text(encoding="utf-8"):
            offenders.append(str(path.relative_to(APP_DIR)))
    assert offenders == [], f"core modules reference the coach plugin: {offenders}"

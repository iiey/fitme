from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

import yaml

# A "skill" is a curated, sport-specific coaching rule set authored in markdown
# (NOT a function tool - tools read data; a skill is instruction text). Each file
# in ``skills/`` has YAML frontmatter (name, description) and a markdown body that
# is injected into the agent's instructions for one message when the athlete picks
# it from the chat "/" menu. This module is the only place skills are loaded.

_SKILLS_DIR = Path(__file__).parent / "skills"

# Stable display order for the catalog; files not listed here fall back to
# alphabetical order after these.
_ORDER = ("run", "ride", "swim", "strength", "yoga", "nutrition")


@dataclass(frozen=True)
class Skill:
    """One coaching skill: ``id`` is the filename stem (e.g. "run")."""

    id: str
    name: str
    description: str
    body: str


def _parse_skill(path: Path) -> Skill:
    """Split a skill markdown file into frontmatter metadata and body."""
    raw = path.read_text(encoding="utf-8")
    meta: dict = {}
    body = raw
    if raw.startswith("---"):
        # Frontmatter is the block between the first two "---" fences.
        _, _, rest = raw.partition("---")
        front, sep, body = rest.partition("---")
        if sep:
            meta = yaml.safe_load(front) or {}
        else:
            body = raw  # No closing fence; treat the whole file as body.
    skill_id = path.stem
    return Skill(
        id=skill_id,
        name=str(meta.get("name") or skill_id.title()),
        description=str(meta.get("description") or ""),
        body=body.strip(),
    )


@lru_cache(maxsize=1)
def _catalog() -> dict[str, Skill]:
    """Load and cache every skill file once, keyed by id."""
    if not _SKILLS_DIR.is_dir():
        return {}
    skills = {path.stem: _parse_skill(path) for path in _SKILLS_DIR.glob("*.md")}

    def sort_key(skill_id: str) -> tuple[int, str]:
        return (_ORDER.index(skill_id) if skill_id in _ORDER else len(_ORDER), skill_id)

    return {skill_id: skills[skill_id] for skill_id in sorted(skills, key=sort_key)}


def list_skills() -> list[Skill]:
    """All available skills in display order."""
    return list(_catalog().values())


def load_skill(skill_id: str) -> Skill | None:
    """One skill by id, or None if the id is unknown."""
    return _catalog().get(skill_id)

from __future__ import annotations

import json
import zlib

from sqlalchemy import LargeBinary
from sqlalchemy.types import TypeDecorator


class CompressedJSON(TypeDecorator):
    """Stores a Python object as zlib-compressed JSON in a BLOB column."""

    impl = LargeBinary
    cache_ok = True

    def process_bind_param(self, value, dialect):
        if value is None:
            return None
        return zlib.compress(json.dumps(value, separators=(",", ":")).encode())

    def process_result_value(self, value, dialect):
        if value is None:
            return None
        return json.loads(zlib.decompress(value))

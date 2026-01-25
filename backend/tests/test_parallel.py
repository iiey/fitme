from __future__ import annotations

from app.ingestion.parallel import FileParser, _parse_one


def test_parse_one_unknown_extension_returns_none():
    key, parsed, error = _parse_one(("k", b"whatever", "xyz"))
    assert key == "k"
    assert parsed is None
    assert error is False


def test_parse_one_bad_fit_flags_error():
    key, parsed, error = _parse_one(("bad", b"not-a-fit-file", "fit"))
    assert key == "bad"
    assert parsed is None
    assert error is True


def test_file_parser_serial_when_disabled():
    with FileParser(enabled=False) as parser:
        assert parser._pool is None
        results = parser.parse_batch([("a", b"garbage", "fit"), ("b", b"x", "unknown")])

    by_key = {key: (parsed, error) for key, parsed, error in results}
    # A malformed FIT is reported as an error; an unknown extension is skipped.
    assert by_key["a"] == (None, True)
    assert by_key["b"] == (None, False)


def test_file_parser_empty_batch():
    with FileParser(enabled=False) as parser:
        assert parser.parse_batch([]) == []

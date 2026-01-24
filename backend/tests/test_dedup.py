from __future__ import annotations

from datetime import datetime

from app.domain.dedup import compute_dedup_key


def test_identical_inputs_produce_same_key():
    start = datetime(2024, 4, 1, 6, 0, 0)
    a = compute_dedup_key("Run", start, 10000.0, 3000)
    b = compute_dedup_key("Run", start, 10000.0, 3000)
    assert a == b
    assert a is not None


def test_small_differences_collapse_onto_same_key():
    start = datetime(2024, 4, 1, 6, 0, 12)  # +12 s, same minute bucket
    base = compute_dedup_key("Run", datetime(2024, 4, 1, 6, 0, 0), 10000.0, 3000)
    near = compute_dedup_key("Run", start, 10040.0, 3010)  # +40 m, +10 s
    assert base == near


def test_different_sport_differs():
    start = datetime(2024, 4, 1, 6, 0, 0)
    run = compute_dedup_key("Run", start, 10000.0, 3000)
    ride = compute_dedup_key("Ride", start, 10000.0, 3000)
    assert run != ride


def test_different_start_minute_differs():
    a = compute_dedup_key("Run", datetime(2024, 4, 1, 6, 0, 0), 10000.0, 3000)
    b = compute_dedup_key("Run", datetime(2024, 4, 1, 6, 5, 0), 10000.0, 3000)
    assert a != b


def test_large_distance_difference_differs():
    start = datetime(2024, 4, 1, 6, 0, 0)
    short = compute_dedup_key("Run", start, 5000.0, 3000)
    long = compute_dedup_key("Run", start, 10000.0, 3000)
    assert short != long


def test_missing_start_returns_none():
    assert compute_dedup_key("Run", None, 10000.0, 3000) is None


def test_missing_metrics_are_treated_as_zero():
    start = datetime(2024, 4, 1, 6, 0, 0)
    a = compute_dedup_key("Run", start, None, None)
    b = compute_dedup_key("Run", start, 0.0, 0)
    assert a == b
    assert a is not None

from __future__ import annotations

from datetime import date

from app.domain.eddington import compute_eddington, daily_distances


def test_eddington_basic():
    # 5 days at 5 units each => E = 5 (5 days with >= 5).
    distances = {date(2024, 1, day): 5.0 for day in range(1, 6)}
    result = compute_eddington(distances)
    assert result.number == 5
    assert result.longest_day == 5


def test_eddington_classic_example():
    # Days with distances 1..10 => E should be 5
    # (5 days have distance >= 5: namely 5,6,7,8,9,10 -> actually 6 days >=5 so E grows).
    distances = {date(2024, 1, day): float(day) for day in range(1, 11)}
    result = compute_eddington(distances)
    # times_completed[d] counts days with distance >= d.
    # d=7: days {7,8,9,10} = 4 < 7; d=6: {6..10}=5 <6; d=5:{5..10}=6>=5 -> E=5? check 6: 5<6
    assert result.number == 5


def test_eddington_empty():
    result = compute_eddington({})
    assert result.number == 0
    assert result.times_completed == {}


def test_eddington_history_is_chronological():
    distances = {date(2024, 1, day): float(day) for day in range(1, 11)}
    result = compute_eddington(distances)
    history_dates = list(result.history.values())
    assert history_dates == sorted(history_dates)


def test_daily_distances_aggregates_same_day():
    pairs = [
        (date(2024, 1, 1), 10.0),
        (date(2024, 1, 1), 5.0),
        (date(2024, 1, 2), 8.0),
    ]
    totals = daily_distances(pairs)
    assert totals[date(2024, 1, 1)] == 15.0
    assert totals[date(2024, 1, 2)] == 8.0

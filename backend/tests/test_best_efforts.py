from __future__ import annotations

from app.domain.best_efforts import (
    MAX_PLAUSIBLE_RIDE_SPEED_MS,
    MAX_PLAUSIBLE_RUN_SPEED_MS,
    _max_plausible_speed,
    compute_best_efforts,
)
from app.enums import ActivityType, SportType, StreamType


def _streams(distances: list[float], times: list[float]) -> dict[str, list]:
    return {StreamType.DISTANCE.value: distances, StreamType.TIME.value: times}


def test_max_plausible_speed_per_activity_type():
    assert _max_plausible_speed(SportType.RUN) == MAX_PLAUSIBLE_RUN_SPEED_MS
    assert _max_plausible_speed(SportType.TRAIL_RUN) == MAX_PLAUSIBLE_RUN_SPEED_MS
    assert _max_plausible_speed(SportType.RIDE) == MAX_PLAUSIBLE_RIDE_SPEED_MS


def test_clean_run_finds_real_fastest_400m():
    # Steady 5 m/s run sampled every 50 m (10 s apart). The fastest 400 m is
    # 8 consecutive segments = 80 s, and must be left untouched.
    distances = [50.0 * i for i in range(21)]  # 0..1000 m
    times = [10.0 * i for i in range(21)]  # 5 m/s
    efforts = dict(compute_best_efforts(_streams(distances, times), SportType.RUN))
    assert efforts[400] == 80.0


def test_gps_glitch_400m_is_rejected():
    # A clean 5 m/s run (50 m / 10 s per sample) with one sample teleporting
    # +500 m in 1 s (a GPS glitch). Raw, the "fastest 400 m" would read under a
    # second; after glitch removal it must report the genuine 80 s effort.
    distances: list[float] = []
    times: list[float] = []
    d = 0.0
    t = 0.0
    for i in range(30):
        distances.append(d)
        times.append(t)
        if i == 15:
            d += 500.0  # spurious teleport
            t += 1.0
        else:
            d += 50.0
            t += 10.0  # 5 m/s

    efforts = dict(compute_best_efforts(_streams(distances, times), SportType.RUN))
    # The genuine fastest 400 m (8 x 50 m / 10 s) is 80 s; the glitch must not
    # produce anything faster.
    assert efforts[400] == 80.0


def test_cycling_allows_fast_descent_but_rejects_teleport():
    # A 1 km descent at 25 m/s (90 km/h) is fast but real -> accepted as-is.
    distances = [250.0 * i for i in range(6)]  # 0..1250 m
    times = [10.0 * i for i in range(6)]  # 25 m/s
    efforts = dict(compute_best_efforts(_streams(distances, times), SportType.RIDE))
    assert efforts[1000] == 40.0  # 1000 m / 25 m/s

    # A teleport glitch (1 km in 1 s = 1000 m/s) must be removed, so no
    # impossibly fast 1 km is reported from it.
    glitch = _streams([0.0, 1000.0, 1010.0], [0.0, 1.0, 2.0])
    assert compute_best_efforts(glitch, SportType.RIDE) == []


def test_non_best_effort_sport_returns_nothing():
    distances = [100.0 * i for i in range(11)]
    times = [25.0 * i for i in range(11)]
    assert compute_best_efforts(_streams(distances, times), SportType.SWIM) == []
    assert SportType.SWIM.activity_type == ActivityType.WATER_SPORTS

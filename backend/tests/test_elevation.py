from __future__ import annotations

from app.ingestion.parsed import _elevation_gain
from app.ingestion.upsert import _merge_elevation


def test_elevation_gain_dampens_sensor_noise():
    # A dead-flat track recorded as alternating 1 m barometric jitter must not
    # accumulate into a large "climb".
    noisy_flat = [100.0 + (1.0 if i % 2 else -1.0) for i in range(200)]
    assert _elevation_gain(noisy_flat) < 5.0


def test_elevation_gain_preserves_real_climb():
    # A steady 100 m ascent should survive smoothing largely intact.
    climb = [float(i) for i in range(0, 101)]
    gain = _elevation_gain(climb)
    assert 90.0 <= gain <= 100.0


def test_elevation_gain_empty():
    assert _elevation_gain([]) == 0.0


def test_merge_elevation_prefers_plausible_source():
    # Summary and stream roughly agree -> keep the provider's summary value.
    assert _merge_elevation(1200.0, 1150.0) == 1200.0


def test_merge_elevation_rejects_barometric_spike():
    # Provider summary dwarfs the stream-derived gain -> treat as a glitch.
    assert _merge_elevation(2075.0, 39.0) == 39.0


def test_merge_elevation_keeps_source_without_stream():
    # No altitude stream to validate against -> trust the summary.
    assert _merge_elevation(2075.0, None) == 2075.0


def test_merge_elevation_falls_back_when_source_missing():
    assert _merge_elevation(None, 42.0) == 42.0
    assert _merge_elevation(None, None) == 0.0

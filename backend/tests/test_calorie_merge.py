from __future__ import annotations

from app.ingestion.garmin import _kj_to_kcal


def test_kj_to_kcal_converts_garmin_summary_energy():
    # Garmin's bulk-export summary reports energy in kilojoules; FitMe uses
    # kcal. A 21 km run summarised as 4852 kJ is ~1159 kcal (Garmin Connect
    # and the device's own FIT report 1158).
    assert _kj_to_kcal(4852.04) == 1160
    assert _kj_to_kcal(901) == 215


def test_kj_to_kcal_handles_missing_value():
    assert _kj_to_kcal(None) is None

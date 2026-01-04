from __future__ import annotations

from app.domain.best_efforts import compute_best_efforts
from app.enums import SportType, StreamType
from app.ingestion import polyline
from app.ingestion.gpx import parse_gpx
from app.ingestion.tcx import parse_tcx

SAMPLE_GPX = """<?xml version="1.0"?>
<gpx xmlns="http://www.topografix.com/GPX/1/1"
     xmlns:gpxtpx="http://www.garmin.com/xmlschemas/TrackPointExtension/v1">
<trk><type>running</type><trkseg>
<trkpt lat="50.0000" lon="4.0000"><ele>100</ele><time>2024-04-01T06:00:00Z</time>
<extensions><gpxtpx:TrackPointExtension><gpxtpx:hr>120</gpxtpx:hr></gpxtpx:TrackPointExtension></extensions></trkpt>
<trkpt lat="50.0090" lon="4.0000"><ele>105</ele><time>2024-04-01T06:05:00Z</time>
<extensions><gpxtpx:TrackPointExtension><gpxtpx:hr>150</gpxtpx:hr></gpxtpx:TrackPointExtension></extensions></trkpt>
<trkpt lat="50.0180" lon="4.0000"><ele>110</ele><time>2024-04-01T06:10:00Z</time>
<extensions><gpxtpx:TrackPointExtension><gpxtpx:hr>160</gpxtpx:hr></gpxtpx:TrackPointExtension></extensions></trkpt>
</trkseg></trk></gpx>"""

SAMPLE_TCX = """<?xml version="1.0"?>
<TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2">
<Activities><Activity Sport="Biking"><Lap><Calories>120</Calories><Track>
<Trackpoint><Time>2024-04-01T06:00:00Z</Time><Position><LatitudeDegrees>50.0</LatitudeDegrees>
<LongitudeDegrees>4.0</LongitudeDegrees></Position><AltitudeMeters>100</AltitudeMeters>
<DistanceMeters>0</DistanceMeters><HeartRateBpm><Value>120</Value></HeartRateBpm></Trackpoint>
<Trackpoint><Time>2024-04-01T06:01:00Z</Time><Position><LatitudeDegrees>50.005</LatitudeDegrees>
<LongitudeDegrees>4.0</LongitudeDegrees></Position><AltitudeMeters>110</AltitudeMeters>
<DistanceMeters>556</DistanceMeters><HeartRateBpm><Value>140</Value></HeartRateBpm></Trackpoint>
</Track></Lap></Activity></Activities></TrainingCenterDatabase>"""


def test_parse_gpx_extracts_streams_and_sport():
    parsed = parse_gpx(SAMPLE_GPX)
    assert parsed.sport_type == "Run"
    assert parsed.start_time is not None
    distances = parsed.streams[StreamType.DISTANCE.value]
    assert distances[-1] > 1900  # ~2 km north-south displacement
    assert parsed.streams[StreamType.HEART_RATE.value][-1] == 160


def test_parse_tcx_uses_distance_field():
    parsed = parse_tcx(SAMPLE_TCX)
    assert parsed.sport_type == "Ride"
    assert parsed.calories == 120
    assert parsed.streams[StreamType.DISTANCE.value][-1] == 556


def test_best_efforts_finds_standard_distances():
    parsed = parse_gpx(SAMPLE_GPX)
    efforts = dict(compute_best_efforts(parsed.streams, SportType.RUN))
    # The track covers ~2 km, so 400m/805m/1000m/1609m efforts should exist.
    assert 1000 in efforts
    assert 1609 in efforts
    assert efforts[1000] > 0


def test_polyline_roundtrip():
    coordinates = [[50.0, 4.0], [50.009, 4.0], [50.018, 4.001]]
    encoded = polyline.encode(coordinates)
    decoded = polyline.decode(encoded)
    assert len(decoded) == len(coordinates)
    for original, result in zip(coordinates, decoded, strict=True):
        assert abs(original[0] - result[0]) < 1e-4
        assert abs(original[1] - result[1]) < 1e-4

from __future__ import annotations

from enum import Enum


class ActivityType(str, Enum):
    """Broad activity grouping (13 categories)."""

    RIDE = "Ride"
    RUN = "Run"
    WALK = "Walk"
    WATER_SPORTS = "WaterSports"
    WINTER_SPORTS = "WinterSports"
    SKATING = "Skating"
    RACQUET_PADDLE_SPORTS = "RacquetPaddleSports"
    FITNESS = "Fitness"
    MIND_BODY_SPORTS = "MindBodySports"
    OUTDOOR_SPORTS = "OutdoorSports"
    TEAM_SPORTS = "TeamSports"
    ADAPTIVE_INCLUSIVE_SPORTS = "AdaptiveInclusiveSports"
    OTHER = "Other"

    @property
    def label(self) -> str:
        return {
            ActivityType.RIDE: "Ride",
            ActivityType.RUN: "Run",
            ActivityType.WALK: "Walk",
            ActivityType.WATER_SPORTS: "Water Sports",
            ActivityType.WINTER_SPORTS: "Winter Sports",
            ActivityType.SKATING: "Skating",
            ActivityType.RACQUET_PADDLE_SPORTS: "Racquet & Paddle Sports",
            ActivityType.FITNESS: "Fitness",
            ActivityType.MIND_BODY_SPORTS: "Mind & Body Sports",
            ActivityType.OUTDOOR_SPORTS: "Outdoor Sports",
            ActivityType.TEAM_SPORTS: "Team Sports",
            ActivityType.ADAPTIVE_INCLUSIVE_SPORTS: "Adaptive & Inclusive Sports",
            ActivityType.OTHER: "Other",
        }[self]


# Pace preference for the activity type, used by the frontend to format speed.
class PaceUnit(str, Enum):
    KM_PER_HOUR = "km/h"
    SEC_PER_KM = "/km"
    SEC_PER_100M = "/100m"


class SportType(str, Enum):
    """Fine-grained Strava sport type (matches Strava's ``sport_type`` values)."""

    # Cycle.
    RIDE = "Ride"
    MOUNTAIN_BIKE_RIDE = "MountainBikeRide"
    GRAVEL_RIDE = "GravelRide"
    E_BIKE_RIDE = "EBikeRide"
    E_MOUNTAIN_BIKE_RIDE = "EMountainBikeRide"
    VIRTUAL_RIDE = "VirtualRide"
    VELO_MOBILE = "Velomobile"
    # Run.
    RUN = "Run"
    TRAIL_RUN = "TrailRun"
    VIRTUAL_RUN = "VirtualRun"
    # Walk.
    WALK = "Walk"
    HIKE = "Hike"
    # Water sports.
    CANOEING = "Canoeing"
    KAYAKING = "Kayaking"
    KITE_SURF = "Kitesurf"
    ROWING = "Rowing"
    STAND_UP_PADDLING = "StandUpPaddling"
    SURFING = "Surfing"
    SWIM = "Swim"
    WIND_SURF = "Windsurf"
    # Winter sports.
    BACK_COUNTRY_SKI = "BackcountrySki"
    ALPINE_SKI = "AlpineSki"
    NORDIC_SKI = "NordicSki"
    ICE_SKATE = "IceSkate"
    SNOWBOARD = "Snowboard"
    SNOWSHOE = "Snowshoe"
    # Skating.
    SKATEBOARD = "Skateboard"
    INLINE_SKATE = "InlineSkate"
    ROLLER_SKI = "RollerSki"
    # Racquet & paddle sports.
    BADMINTON = "Badminton"
    PICKLE_BALL = "Pickleball"
    RACQUET_BALL = "Racquetball"
    SQUASH = "Squash"
    TABLE_TENNIS = "TableTennis"
    TENNIS = "Tennis"
    PADEL = "Padel"
    # Fitness.
    CROSSFIT = "Crossfit"
    WEIGHT_TRAINING = "WeightTraining"
    WORKOUT = "Workout"
    STAIR_STEPPER = "StairStepper"
    VIRTUAL_ROW = "VirtualRow"
    HIIT = "HighIntensityIntervalTraining"
    ELLIPTICAL = "Elliptical"
    DANCE = "Dance"
    # Mind & body sports.
    PILATES = "Pilates"
    YOGA = "Yoga"
    PHYSICAL_THERAPY = "PhysicalTherapy"
    # Outdoor sports.
    GOLF = "Golf"
    ROCK_CLIMBING = "RockClimbing"
    SAIL = "Sail"
    # Team sports.
    BASKETBALL = "Basketball"
    SOCCER = "Soccer"
    VOLLEYBALL = "Volleyball"
    CRICKET = "Cricket"
    # Adaptive & inclusive sports.
    HAND_CYCLE = "Handcycle"
    WHEELCHAIR = "Wheelchair"

    @classmethod
    def from_strava(cls, value: str | None) -> SportType:
        """Resolve a Strava ``type``/``sport_type`` string, defaulting to WORKOUT."""
        if not value:
            return cls.WORKOUT
        normalized = value.strip().replace(" ", "")
        for member in cls:
            if member.value.lower() == normalized.lower():
                return member
        # Legacy Strava ``type`` aliases.
        aliases = {
            "ebikeride": cls.E_BIKE_RIDE,
            "virtualride": cls.VIRTUAL_RIDE,
            "alpineski": cls.ALPINE_SKI,
            "nordicski": cls.NORDIC_SKI,
            "standuppaddling": cls.STAND_UP_PADDLING,
        }
        return aliases.get(normalized.lower(), cls.WORKOUT)

    @classmethod
    def from_garmin(cls, activity_type: str | None, sport_type: str | None = None) -> SportType:
        """Resolve a Garmin ``activityType``/``sportType`` to a sport.

        Garmin uses snake_case activity types (``trail_running``,
        ``strength_training``); the broad upper-case ``sportType`` (``RUNNING``)
        is a coarser fallback. Unknown values default to WORKOUT.
        """
        if activity_type:
            mapped = _GARMIN_SPORT_MAP.get(activity_type.strip().lower())
            if mapped is not None:
                return mapped
        if sport_type:
            mapped = _GARMIN_SPORT_TYPE_MAP.get(sport_type.strip().upper())
            if mapped is not None:
                return mapped
        return cls.WORKOUT

    @property
    def activity_type(self) -> ActivityType:
        return _SPORT_TO_ACTIVITY.get(self, ActivityType.OTHER)

    @property
    def label(self) -> str:
        return _SPORT_LABELS.get(self, self.value)

    @property
    def pace_unit(self) -> PaceUnit:
        if self.activity_type in (ActivityType.RUN, ActivityType.WALK):
            return PaceUnit.SEC_PER_KM
        if self is SportType.SWIM:
            return PaceUnit.SEC_PER_100M
        return PaceUnit.KM_PER_HOUR

    @property
    def supports_best_efforts(self) -> bool:
        return self in _BEST_EFFORT_SPORTS

    @property
    def is_distance_based(self) -> bool:
        """Whether distance is a meaningful primary metric for this sport."""
        return self.activity_type in (
            ActivityType.RIDE,
            ActivityType.RUN,
            ActivityType.WALK,
            ActivityType.WATER_SPORTS,
            ActivityType.WINTER_SPORTS,
            ActivityType.SKATING,
        )


class StreamType(str, Enum):
    """Time-series stream types recorded per activity."""

    TIME = "time"
    DISTANCE = "distance"
    LAT_LNG = "latlng"
    ALTITUDE = "altitude"
    VELOCITY = "velocity_smooth"
    HEART_RATE = "heartrate"
    CADENCE = "cadence"
    WATTS = "watts"
    TEMP = "temp"
    MOVING = "moving"
    GRADE = "grade_smooth"


class WorkoutType(str, Enum):
    DEFAULT = "default"
    RACE = "race"
    WORKOUT = "workout"
    LONG_RUN = "longRun"


class ImportSource(str, Enum):
    GPX_FILE = "gpx"
    TCX_FILE = "tcx"
    FIT_FILE = "fit"
    CSV_ONLY = "csv"


_SPORT_TO_ACTIVITY: dict[SportType, ActivityType] = {
    # Ride.
    SportType.RIDE: ActivityType.RIDE,
    SportType.MOUNTAIN_BIKE_RIDE: ActivityType.RIDE,
    SportType.GRAVEL_RIDE: ActivityType.RIDE,
    SportType.E_BIKE_RIDE: ActivityType.RIDE,
    SportType.E_MOUNTAIN_BIKE_RIDE: ActivityType.RIDE,
    SportType.VIRTUAL_RIDE: ActivityType.RIDE,
    SportType.VELO_MOBILE: ActivityType.RIDE,
    # Run.
    SportType.RUN: ActivityType.RUN,
    SportType.TRAIL_RUN: ActivityType.RUN,
    SportType.VIRTUAL_RUN: ActivityType.RUN,
    # Walk.
    SportType.WALK: ActivityType.WALK,
    SportType.HIKE: ActivityType.WALK,
    # Water sports.
    SportType.CANOEING: ActivityType.WATER_SPORTS,
    SportType.KAYAKING: ActivityType.WATER_SPORTS,
    SportType.KITE_SURF: ActivityType.WATER_SPORTS,
    SportType.ROWING: ActivityType.WATER_SPORTS,
    SportType.STAND_UP_PADDLING: ActivityType.WATER_SPORTS,
    SportType.SURFING: ActivityType.WATER_SPORTS,
    SportType.SWIM: ActivityType.WATER_SPORTS,
    SportType.WIND_SURF: ActivityType.WATER_SPORTS,
    # Winter sports.
    SportType.BACK_COUNTRY_SKI: ActivityType.WINTER_SPORTS,
    SportType.ALPINE_SKI: ActivityType.WINTER_SPORTS,
    SportType.NORDIC_SKI: ActivityType.WINTER_SPORTS,
    SportType.ICE_SKATE: ActivityType.WINTER_SPORTS,
    SportType.SNOWBOARD: ActivityType.WINTER_SPORTS,
    SportType.SNOWSHOE: ActivityType.WINTER_SPORTS,
    # Skating.
    SportType.SKATEBOARD: ActivityType.SKATING,
    SportType.INLINE_SKATE: ActivityType.SKATING,
    SportType.ROLLER_SKI: ActivityType.SKATING,
    # Racquet & paddle.
    SportType.BADMINTON: ActivityType.RACQUET_PADDLE_SPORTS,
    SportType.PICKLE_BALL: ActivityType.RACQUET_PADDLE_SPORTS,
    SportType.RACQUET_BALL: ActivityType.RACQUET_PADDLE_SPORTS,
    SportType.SQUASH: ActivityType.RACQUET_PADDLE_SPORTS,
    SportType.TABLE_TENNIS: ActivityType.RACQUET_PADDLE_SPORTS,
    SportType.TENNIS: ActivityType.RACQUET_PADDLE_SPORTS,
    SportType.PADEL: ActivityType.RACQUET_PADDLE_SPORTS,
    # Fitness.
    SportType.CROSSFIT: ActivityType.FITNESS,
    SportType.WEIGHT_TRAINING: ActivityType.FITNESS,
    SportType.WORKOUT: ActivityType.FITNESS,
    SportType.STAIR_STEPPER: ActivityType.FITNESS,
    SportType.VIRTUAL_ROW: ActivityType.FITNESS,
    SportType.HIIT: ActivityType.FITNESS,
    SportType.ELLIPTICAL: ActivityType.FITNESS,
    SportType.DANCE: ActivityType.FITNESS,
    # Mind & body.
    SportType.PILATES: ActivityType.MIND_BODY_SPORTS,
    SportType.YOGA: ActivityType.MIND_BODY_SPORTS,
    SportType.PHYSICAL_THERAPY: ActivityType.MIND_BODY_SPORTS,
    # Outdoor.
    SportType.GOLF: ActivityType.OUTDOOR_SPORTS,
    SportType.ROCK_CLIMBING: ActivityType.OUTDOOR_SPORTS,
    SportType.SAIL: ActivityType.OUTDOOR_SPORTS,
    # Team.
    SportType.SOCCER: ActivityType.TEAM_SPORTS,
    SportType.BASKETBALL: ActivityType.TEAM_SPORTS,
    SportType.VOLLEYBALL: ActivityType.TEAM_SPORTS,
    SportType.CRICKET: ActivityType.TEAM_SPORTS,
    # Adaptive.
    SportType.HAND_CYCLE: ActivityType.ADAPTIVE_INCLUSIVE_SPORTS,
    SportType.WHEELCHAIR: ActivityType.ADAPTIVE_INCLUSIVE_SPORTS,
}

# Garmin Connect ``activityType`` (fine-grained, snake_case) -> Strava sport.
_GARMIN_SPORT_MAP: dict[str, SportType] = {
    # Run.
    "running": SportType.RUN,
    "street_running": SportType.RUN,
    "track_running": SportType.RUN,
    "trail_running": SportType.TRAIL_RUN,
    "treadmill_running": SportType.VIRTUAL_RUN,
    "indoor_running": SportType.VIRTUAL_RUN,
    "virtual_run": SportType.VIRTUAL_RUN,
    "obstacle_run": SportType.RUN,
    # Ride.
    "cycling": SportType.RIDE,
    "road_biking": SportType.RIDE,
    "mountain_biking": SportType.MOUNTAIN_BIKE_RIDE,
    "gravel_cycling": SportType.GRAVEL_RIDE,
    "cyclocross": SportType.MOUNTAIN_BIKE_RIDE,
    "indoor_cycling": SportType.VIRTUAL_RIDE,
    "virtual_ride": SportType.VIRTUAL_RIDE,
    "e_bike_fitness": SportType.E_BIKE_RIDE,
    "e_bike_mountain": SportType.E_MOUNTAIN_BIKE_RIDE,
    # Walk / hike.
    "walking": SportType.WALK,
    "casual_walking": SportType.WALK,
    "speed_walking": SportType.WALK,
    "hiking": SportType.HIKE,
    "mountaineering": SportType.HIKE,
    # Water.
    "swimming": SportType.SWIM,
    "lap_swimming": SportType.SWIM,
    "open_water_swimming": SportType.SWIM,
    "rowing": SportType.ROWING,
    "indoor_rowing": SportType.ROWING,
    "kayaking": SportType.KAYAKING,
    "stand_up_paddleboarding": SportType.STAND_UP_PADDLING,
    "surfing": SportType.SURFING,
    "windsurfing": SportType.WIND_SURF,
    "whitewater_rafting": SportType.CANOEING,
    # Winter.
    "resort_skiing": SportType.ALPINE_SKI,
    "resort_skiing_snowboarding": SportType.ALPINE_SKI,
    "backcountry_skiing": SportType.BACK_COUNTRY_SKI,
    "cross_country_skiing": SportType.NORDIC_SKI,
    "skate_skiing": SportType.NORDIC_SKI,
    "snowboarding": SportType.SNOWBOARD,
    "snowshoeing": SportType.SNOWSHOE,
    "ice_skating": SportType.ICE_SKATE,
    # Skating.
    "inline_skating": SportType.INLINE_SKATE,
    "skateboarding": SportType.SKATEBOARD,
    # Racquet & paddle.
    "tennis": SportType.TENNIS,
    "table_tennis": SportType.TABLE_TENNIS,
    "badminton": SportType.BADMINTON,
    "squash": SportType.SQUASH,
    "racquetball": SportType.RACQUET_BALL,
    "pickleball": SportType.PICKLE_BALL,
    "padel": SportType.PADEL,
    # Fitness.
    "strength_training": SportType.WEIGHT_TRAINING,
    "indoor_cardio": SportType.WORKOUT,
    "cardio": SportType.WORKOUT,
    "fitness_equipment": SportType.WORKOUT,
    "hiit": SportType.HIIT,
    "elliptical": SportType.ELLIPTICAL,
    "stair_climbing": SportType.STAIR_STEPPER,
    "indoor_climbing": SportType.ROCK_CLIMBING,
    "bouldering": SportType.ROCK_CLIMBING,
    # Mind & body.
    "yoga": SportType.YOGA,
    "pilates": SportType.PILATES,
    "breathwork": SportType.YOGA,
    "meditation": SportType.YOGA,
    # Outdoor.
    "rock_climbing": SportType.ROCK_CLIMBING,
    "golf": SportType.GOLF,
    "sailing": SportType.SAIL,
    # Team.
    "soccer": SportType.SOCCER,
    "basketball": SportType.BASKETBALL,
    "volleyball": SportType.VOLLEYBALL,
}

# Garmin ``sportType`` (broad, upper-case) -> Strava sport, used as a fallback.
_GARMIN_SPORT_TYPE_MAP: dict[str, SportType] = {
    "RUNNING": SportType.RUN,
    "CYCLING": SportType.RIDE,
    "WALKING": SportType.WALK,
    "STEPS": SportType.WALK,
    "HIKING": SportType.HIKE,
    "SWIMMING": SportType.SWIM,
    "HIIT": SportType.HIIT,
    "FITNESS_EQUIPMENT": SportType.WORKOUT,
    "TRAINING": SportType.WORKOUT,
    "MULTISPORT": SportType.WORKOUT,
    "WINTER_SPORTS": SportType.SNOWBOARD,
}

_BEST_EFFORT_SPORTS = {
    SportType.RIDE,
    SportType.MOUNTAIN_BIKE_RIDE,
    SportType.GRAVEL_RIDE,
    SportType.VIRTUAL_RIDE,
    SportType.E_MOUNTAIN_BIKE_RIDE,
    SportType.RUN,
    SportType.TRAIL_RUN,
    SportType.VIRTUAL_RUN,
}

_SPORT_LABELS: dict[SportType, str] = {
    SportType.RIDE: "Ride",
    SportType.MOUNTAIN_BIKE_RIDE: "Mountain Bike Ride",
    SportType.GRAVEL_RIDE: "Gravel Ride",
    SportType.E_BIKE_RIDE: "E-Bike Ride",
    SportType.E_MOUNTAIN_BIKE_RIDE: "E-Mountain Bike Ride",
    SportType.VIRTUAL_RIDE: "Virtual Ride",
    SportType.VELO_MOBILE: "Velomobile",
    SportType.RUN: "Run",
    SportType.TRAIL_RUN: "Trail Run",
    SportType.VIRTUAL_RUN: "Virtual Run",
    SportType.WALK: "Walk",
    SportType.HIKE: "Hike",
    SportType.CANOEING: "Canoeing",
    SportType.KAYAKING: "Kayaking",
    SportType.KITE_SURF: "Kitesurf",
    SportType.ROWING: "Rowing",
    SportType.STAND_UP_PADDLING: "Stand Up Paddling",
    SportType.SURFING: "Surfing",
    SportType.SWIM: "Swim",
    SportType.WIND_SURF: "Windsurf",
    SportType.BACK_COUNTRY_SKI: "Backcountry Ski",
    SportType.ALPINE_SKI: "Alpine Ski",
    SportType.NORDIC_SKI: "Nordic Ski",
    SportType.ICE_SKATE: "Ice Skate",
    SportType.SNOWBOARD: "Snowboard",
    SportType.SNOWSHOE: "Snowshoe",
    SportType.SKATEBOARD: "Skateboard",
    SportType.INLINE_SKATE: "Inline Skate",
    SportType.ROLLER_SKI: "Roller Ski",
    SportType.BADMINTON: "Badminton",
    SportType.PICKLE_BALL: "Pickleball",
    SportType.RACQUET_BALL: "Racquetball",
    SportType.SQUASH: "Squash",
    SportType.TABLE_TENNIS: "Table Tennis",
    SportType.TENNIS: "Tennis",
    SportType.PADEL: "Padel",
    SportType.CROSSFIT: "Crossfit",
    SportType.WEIGHT_TRAINING: "Weight Training",
    SportType.WORKOUT: "Workout",
    SportType.STAIR_STEPPER: "Stair Stepper",
    SportType.VIRTUAL_ROW: "Virtual Row",
    SportType.HIIT: "HIIT",
    SportType.ELLIPTICAL: "Elliptical",
    SportType.DANCE: "Dance",
    SportType.PILATES: "Pilates",
    SportType.YOGA: "Yoga",
    SportType.PHYSICAL_THERAPY: "Physical Therapy",
    SportType.GOLF: "Golf",
    SportType.ROCK_CLIMBING: "Rock Climbing",
    SportType.SAIL: "Sail",
    SportType.BASKETBALL: "Basketball",
    SportType.SOCCER: "Soccer",
    SportType.VOLLEYBALL: "Volleyball",
    SportType.CRICKET: "Cricket",
    SportType.HAND_CYCLE: "Handcycle",
    SportType.WHEELCHAIR: "Wheelchair",
}

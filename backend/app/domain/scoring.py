"""The scoring model, as pure functions with no I/O.

Every rule that decides a number is here, and /about on the frontend describes
the same 50/50 split between static baseline and live signal.
"""

from collections.abc import Iterable
from dataclasses import dataclass
from typing import Literal

from app.domain.hazards import ALERT_RULES, Hazard

Tier = Literal["Low", "Moderate", "Elevated", "Critical"]

BASELINE_WEIGHT = 0.5
LIVE_WEIGHT = 0.5

# Lowest score for each tier, highest first. These match the frontend's hazard
# bar colours, which change at 75 and 50.
TIER_FLOORS: list[tuple[int, Tier]] = [
    (75, "Critical"),
    (50, "Elevated"),
    (30, "Moderate"),
    (0, "Low"),
]

# Earthquake thresholds from the data dictionary on /about.
QUAKE_RADIUS_MILES = 30
QUAKE_CRITICAL_RADIUS_MILES = 20
QUAKE_CRITICAL_MAGNITUDE = 5.5
QUAKE_STRONG_MAGNITUDE = 4.5
QUAKE_ADVISORY_MAGNITUDE = 3.0

# Weather thresholds from the data dictionary on /about.
FIRE_RH_LIMIT = 15
FIRE_GUST_LIMIT_MPH = 25
GUST_ADVISORY_MPH = 40
GUST_CRITICAL_MPH = 58

# NWPS flood category to live flood score. Other categories, such as
# "not_defined" or "obs_not_current", say nothing about flooding.
GAUGE_CATEGORY_SCORES = {
    "major": 100,
    "moderate": 85,
    "minor": 70,
    "action": 40,
    "no_flooding": 0,
}


@dataclass(frozen=True)
class LiveSignal:
    """One piece of live evidence for a hazard: its score and a sentence explaining it."""

    hazard: Hazard
    score: int
    text: str


def tier_for(score: int) -> Tier:
    """Map a 0 to 100 score to its tier name.

    Args:
        score: Any hazard or composite score.
    Returns:
        "Low", "Moderate", "Elevated" or "Critical", per TIER_FLOORS.
    Called by: general utility, used for every score RiskService returns.
    """
    for floor, tier in TIER_FLOORS:
        if score >= floor:
            return tier
    return "Low"


def hazard_score(baseline: int, live: int) -> int:
    """Blend a hazard's static baseline with its live signal, 50/50.

    Args:
        baseline: The county's baseline percentile for the hazard, 0 to 100.
        live: The strongest live signal score for the hazard, 0 to 100 (0 if none).
    Returns:
        The hazard score, 0 to 100.
    Called by: snapshot.build_snapshot, RiskService.get_county.
    """
    return round(BASELINE_WEIGHT * baseline + LIVE_WEIGHT * live)


def composite_score(hazard_scores: Iterable[int]) -> int:
    """Combine hazard scores into one score, weighted toward the worst.

    A plain average would let hazards that don't apply to a place, such as
    hurricanes in Nevada, hide the one that does. So this is 60% the highest
    score and 40% the mean of the top three.

    Args:
        hazard_scores: One score per hazard.
    Returns:
        The composite score, 0 to 100 (0 if there are no scores).
    Called by: snapshot.build_snapshot, RiskService.get_county.
    """
    top = sorted(hazard_scores, reverse=True)[:3]
    if not top:
        return 0
    return round(0.6 * top[0] + 0.4 * sum(top) / len(top))


def alert_signal(event: str) -> LiveSignal | None:
    """Turn an NWS alert event into a live signal, if it's one we score.

    Args:
        event: The alert's event name, e.g. "Flood Warning".
    Returns:
        A LiveSignal from ALERT_RULES, or None if the event isn't scored.
    Called by: snapshot._apply_alerts.
    """
    rule = ALERT_RULES.get(event)
    if rule is None:
        return None
    hazard, score = rule
    return LiveSignal(hazard, score, f"{event} active")


def quake_score(magnitude: float, distance_miles: float) -> int:
    """Score an earthquake by magnitude and distance from a county.

    Args:
        magnitude: Earthquake magnitude.
        distance_miles: Distance from the quake to the county's bounding box.
    Returns:
        100, 75, 45 or 0, per the thresholds at the top of this module.
    Called by: snapshot._apply_quakes.
    """
    if distance_miles <= QUAKE_CRITICAL_RADIUS_MILES and magnitude >= QUAKE_CRITICAL_MAGNITUDE:
        return 100
    if distance_miles <= QUAKE_RADIUS_MILES:
        if magnitude >= QUAKE_STRONG_MAGNITUDE:
            return 75
        if magnitude >= QUAKE_ADVISORY_MAGNITUDE:
            return 45
    return 0


# Weather scores nothing below the advisory thresholds. The map can't include
# per-county weather, so this keeps a county's detail score equal to its map value
# except when conditions are actually hazardous.
def wildfire_weather_score(fire_advisory_hour: bool) -> int:
    """Score the forecast's fire weather.

    Args:
        fire_advisory_hour: Whether one forecast hour met both fire limits at once
            (humidity at most FIRE_RH_LIMIT and gusts at least FIRE_GUST_LIMIT_MPH).
    Returns:
        80 if so, else 0.
    Called by: risk._weather_signals.
    """
    return 80 if fire_advisory_hour else 0


def wind_score(max_gust_mph: float) -> int:
    """Score the forecast's strongest wind gust.

    Args:
        max_gust_mph: Highest gust in the next 24 hours.
    Returns:
        100 at GUST_CRITICAL_MPH or more, 70 at GUST_ADVISORY_MPH or more, else 0.
    Called by: risk._weather_signals.
    """
    if max_gust_mph >= GUST_CRITICAL_MPH:
        return 100
    if max_gust_mph >= GUST_ADVISORY_MPH:
        return 70
    return 0

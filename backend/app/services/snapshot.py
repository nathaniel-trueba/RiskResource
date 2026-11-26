"""National scores, computed from the static baseline plus the two nationwide live feeds.

NWS alerts and USGS earthquakes each take one call for the whole country, so
they can score every county. Open-Meteo and NWPS can't, so they're only used for
single-county requests (see services/risk.py). The wildfire model's weekly
scores are nationwide too, and are folded into each overall score here.
"""

from dataclasses import dataclass, replace
from datetime import datetime

import numpy as np

from app.clients.nws import Alert
from app.clients.usgs import Quake
from app.domain.geo import distance_to_boxes_miles
from app.domain.hazards import ALERT_RULES, Hazard
from app.domain.scoring import (
    QUAKE_RADIUS_MILES,
    LiveSignal,
    alert_signal,
    composite_score,
    hazard_score,
    overall_score,
    quake_score,
)
from app.services.reference import ReferenceData
from app.services.wildfire_model import WildfireModelScores

_SEVERITY_RANK = {"Extreme": 4, "Severe": 3, "Moderate": 2, "Minor": 1}


@dataclass(frozen=True)
class Snapshot:
    signals: dict[str, dict[Hazard, LiveSignal]]  # Strongest signal by county and hazard
    alerts: dict[str, list[Alert]]  # By county, most important first
    county_scores: dict[str, dict[Hazard, int]]
    county_composite: dict[str, int]  # Overall score: hazards plus the wildfire model
    state_scores: dict[str, dict[Hazard, int]]
    state_composite: dict[str, int]
    # Wildfire model score by area. Areas without one are absent.
    county_model: dict[str, int]
    state_model: dict[str, int]
    model: WildfireModelScores | None  # None when the weekly file is missing or stale
    nws_available: bool
    usgs_available: bool
    # Set when NWS was unreachable and the alerts came from the Lambda's archive:
    # the time of the run they're from. None for live alerts.
    alerts_as_of: datetime | None = None


def alert_importance(alert: Alert) -> tuple[int, int]:
    """Sort key ranking alerts by their live score, then NWS severity.

    Args:
        alert: The alert.
    Returns:
        (score from ALERT_RULES or 0, severity rank). Higher is more important.
    Called by: _apply_alerts, risk._state_primary_alert.
    """
    rule = ALERT_RULES.get(alert.event)
    return (rule[1] if rule else 0, _SEVERITY_RANK.get(alert.severity, 0))


def archive_note(as_of: datetime) -> str:
    """Say that alerts come from the archive, e.g. "(as of 14:15 UTC; live NWS feed unavailable)".

    Args:
        as_of: The archive run the alerts came from.
    Returns:
        The note, in parentheses.
    Called by: _apply_alerts, and risk's alert and warning texts.
    """
    return f"(as of {as_of:%H:%M} UTC; live NWS feed unavailable)"


def merge_signal(signals: dict[Hazard, LiveSignal], signal: LiveSignal) -> None:
    """Keep the stronger signal for a hazard. On a tie, the existing one stays.

    Args:
        signals: One area's strongest signal per hazard. Updated in place.
        signal: The new signal.
    Returns:
        None.
    Called by: _apply_alerts, _apply_quakes, RiskService.get_county.
    """
    current = signals.get(signal.hazard)
    if current is None or signal.score > current.score:
        signals[signal.hazard] = signal


def build_snapshot(
    reference: ReferenceData,
    alerts: list[Alert] | None,
    quakes: list[Quake] | None,
    model: WildfireModelScores | None = None,
    alerts_as_of: datetime | None = None,
) -> Snapshot:
    """Compute every county and state score from the baseline, national feeds and model.

    Args:
        reference: Static county and state data.
        alerts: Active NWS alerts, or None if the feed is unavailable.
        quakes: Recent USGS earthquakes, or None if the feed is unavailable.
        model: This week's wildfire model scores, or None if unavailable.
        alerts_as_of: When `alerts` came from the archive, the time of that run.
            Alert texts then say so.
    Returns:
        The Snapshot.
    Called by: RiskService._build_snapshot.
    """
    signals: dict[str, dict[Hazard, LiveSignal]] = {fips: {} for fips in reference.counties}
    alerts_by_county = _apply_alerts(reference, alerts or [], signals, alerts_as_of)
    _apply_quakes(reference, quakes or [], signals)

    county_scores = {
        fips: {
            hazard: hazard_score(
                baseline, signals[fips][hazard].score if hazard in signals[fips] else 0
            )
            for hazard, baseline in county.baseline_scores.items()
        }
        for fips, county in reference.counties.items()
    }
    state_scores = {
        code: _population_weighted(reference, state.county_fips, county_scores)
        for code, state in reference.states.items()
    }
    county_model = (
        {f: s for f, s in model.scores.items() if f in reference.counties} if model else {}
    )
    state_model = {
        code: score
        for code, state in reference.states.items()
        if (score := _population_weighted_model(reference, state.county_fips, county_model))
        is not None
    }
    return Snapshot(
        signals=signals,
        alerts=alerts_by_county,
        county_scores=county_scores,
        county_composite={
            f: overall_score(composite_score(s.values()), county_model.get(f))
            for f, s in county_scores.items()
        },
        state_scores=state_scores,
        state_composite={
            c: overall_score(composite_score(s.values()), state_model.get(c))
            for c, s in state_scores.items()
        },
        county_model=county_model,
        state_model=state_model,
        model=model,
        nws_available=alerts is not None,
        usgs_available=quakes is not None,
        alerts_as_of=alerts_as_of,
    )


def _apply_alerts(
    reference: ReferenceData,
    alerts: list[Alert],
    signals: dict[str, dict[Hazard, LiveSignal]],
    as_of: datetime | None = None,
) -> dict[str, list[Alert]]:
    """Attach alerts to their counties and record each one's live signal.

    Args:
        reference: Static data, to skip codes that aren't counties (e.g. marine zones).
        alerts: Active alerts.
        signals: Strongest signal per county and hazard. Updated in place.
        as_of: When the alerts came from the archive, the time of that run. Their
            signal texts then carry archive_note.
    Returns:
        Alerts by county FIPS, most important first.
    Called by: build_snapshot.
    """
    by_county: dict[str, list[Alert]] = {}
    for alert in alerts:
        signal = alert_signal(alert.event)
        if signal and as_of is not None:
            signal = replace(signal, text=f"{signal.text} {archive_note(as_of)}")
        for fips in alert.county_fips:
            if fips not in reference.counties:
                continue  # A marine zone or a whole-state code
            by_county.setdefault(fips, []).append(alert)
            if signal:
                merge_signal(signals[fips], signal)
    for county_alerts in by_county.values():
        county_alerts.sort(key=alert_importance, reverse=True)
    return by_county


def _apply_quakes(
    reference: ReferenceData,
    quakes: list[Quake],
    signals: dict[str, dict[Hazard, LiveSignal]],
) -> None:
    """Record a live earthquake signal for each county near a recent quake.

    Args:
        reference: Static data, for county bounding boxes.
        quakes: Recent earthquakes.
        signals: Strongest signal per county and hazard. Updated in place.
    Returns:
        None.
    Called by: build_snapshot.
    """
    fips_list = list(reference.counties)
    boxes = np.array([reference.counties[f].bbox for f in fips_list])

    for quake in quakes:
        distances = distance_to_boxes_miles(boxes, quake.latitude, quake.longitude)
        for index in np.nonzero(distances <= QUAKE_RADIUS_MILES)[0]:
            score = quake_score(quake.magnitude, float(distances[index]))
            if score:
                text = f"M{quake.magnitude:.1f} earthquake {quake.place}, in the past week"
                merge_signal(signals[fips_list[index]], LiveSignal(Hazard.EARTHQUAKE, score, text))


def _population_weighted(
    reference: ReferenceData,
    county_fips: tuple[str, ...],
    county_scores: dict[str, dict[Hazard, int]],
) -> dict[Hazard, int]:
    """Average county hazard scores into state scores, weighted by population.

    Where population is unknown (Puerto Rico), counties are weighted equally.

    Args:
        reference: Static data, for county populations.
        county_fips: The state's counties.
        county_scores: Score per county and hazard.
    Returns:
        The state's score per hazard.
    Called by: build_snapshot.
    """
    # Where population is unknown (Puerto Rico), counties are weighted equally.
    weights = [reference.counties[f].population or 1 for f in county_fips]
    total = sum(weights)
    return {
        hazard: round(
            sum(w * county_scores[f][hazard] for w, f in zip(weights, county_fips, strict=True)) / total
        )
        for hazard in Hazard
    }


def _population_weighted_model(
    reference: ReferenceData, county_fips: tuple[str, ...], county_model: dict[str, int]
) -> int | None:
    """Average county wildfire model scores into a state score, weighted by population.

    Only counties that have a model score count, the same way the hazard scores
    are averaged in _population_weighted.

    Args:
        reference: Static data, for county populations.
        county_fips: The state's counties.
        county_model: Model score by county FIPS. Counties without one are absent.
    Returns:
        The state's model score, or None if none of its counties has one.
    Called by: build_snapshot.
    """
    scored = [(reference.counties[f].population or 1, county_model[f]) for f in county_fips if f in county_model]
    if not scored:
        return None
    total = sum(w for w, _ in scored)
    return round(sum(w * s for w, s in scored) / total)

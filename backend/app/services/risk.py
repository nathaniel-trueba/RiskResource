"""Builds the StateRecord, CountyRecord and MapValue responses the frontend consumes."""

import asyncio
from collections.abc import Awaitable, Callable
from enum import StrEnum
from typing import Any

from app.clients.nwps import Gauge, NwpsClient
from app.clients.nws import Alert, NwsClient
from app.clients.open_meteo import Conditions, OpenMeteoClient
from app.clients.usgs import UsgsClient
from app.config import Settings
from app.core.cache import TTLCache, UpstreamUnavailable
from app.domain.hazards import Hazard
from app.domain.scoring import (
    GAUGE_CATEGORY_SCORES,
    LiveSignal,
    composite_score,
    hazard_score,
    tier_for,
    wildfire_weather_score,
    wind_score,
)
from app.schemas import (
    CountyExpectedLoss,
    CountyRecord,
    HazardItem,
    HazardLoss,
    MapValue,
    StateExpectedLoss,
    StateRecord,
)
from app.services.reference import County, CountyLosses, ReferenceData, State, StateLosses
from app.services.snapshot import Snapshot, alert_importance, build_snapshot, merge_signal

NWS_KEY = "nws:alerts"
USGS_KEY = "usgs:recent"
SNAPSHOT_KEY = "snapshot"
WEATHER_PREFIX = "openmeteo:forecast:"
GAUGES_PREFIX = "nwps:gauges:"

# Alert fields are omitted when there are no alerts. So they must carry this text
# when we couldn't check, or an outage would look the same as "no alerts".
ALERTS_UNKNOWN_TEXT = "NWS alert feed unavailable, so alert status is unknown"
LIVE_UNAVAILABLE_SUFFIX = " (live data unavailable)"
UNKNOWN_POPULATION = "N/A"

_NWS_HAZARDS = frozenset(Hazard) - {Hazard.EARTHQUAKE}
_WEATHER_HAZARDS = frozenset({Hazard.WILDFIRE, Hazard.SEVERE_STORM})


class MapLevel(StrEnum):
    STATE = "state"
    COUNTY = "county"


class MapMetric(StrEnum):
    COMPOSITE = "compositeScore"
    WILDFIRE = Hazard.WILDFIRE.value
    EARTHQUAKE = Hazard.EARTHQUAKE.value
    FLOOD = Hazard.FLOOD.value
    SEVERE_STORM = Hazard.SEVERE_STORM.value
    HURRICANE = Hazard.HURRICANE.value
    TORNADO = Hazard.TORNADO.value
    # FEMA NRI expected annual loss. These accept an optional hazard filter.
    LOSS_PER_PERSON = "lossPerPerson"
    TOTAL_LOSS = "totalLoss"
    HIGH_LOSS_PCT = "highLossPct"  # States only


LOSS_METRICS = frozenset({MapMetric.LOSS_PER_PERSON, MapMetric.TOTAL_LOSS, MapMetric.HIGH_LOSS_PCT})


class InvalidMapQuery(ValueError):
    """A map metric was asked for with a level or hazard it doesn't support."""


class RiskService:
    def __init__(
        self,
        settings: Settings,
        cache: TTLCache,
        reference: ReferenceData,
        nws: NwsClient,
        usgs: UsgsClient,
        nwps: NwpsClient,
        open_meteo: OpenMeteoClient,
    ) -> None:
        """Store the shared dependencies. Holds no per-request state.

        Args:
            settings: App settings, for cache lifetimes.
            cache: The shared TTL cache.
            reference: Static county and state data.
            nws: Active alerts client.
            usgs: Recent earthquakes client.
            nwps: River gauges client.
            open_meteo: Forecast client.
        Called by: main.lifespan at startup.
        """
        self._settings = settings
        self._cache = cache
        self._reference = reference
        self._nws = nws
        self._usgs = usgs
        self._nwps = nwps
        self._open_meteo = open_meteo

    async def get_snapshot(self) -> Snapshot:
        """Return the national snapshot, rebuilding it once it's older than its TTL.

        Returns:
            The current Snapshot of scores for every county and state.
        Called by: main.lifespan (warm-up), get_map_values, get_state, get_county.
        """
        return await self._cache.get_or_fetch(
            SNAPSHOT_KEY, self._build_snapshot, self._settings.snapshot_ttl_seconds
        )

    async def get_map_values(
        self, level: MapLevel, metric: MapMetric, hazard: Hazard | None = None
    ) -> list[MapValue]:
        """Return one value per area for the map.

        Args:
            level: States or counties.
            metric: The composite score, one hazard's score, or a loss metric.
            hazard: For lossPerPerson and totalLoss, limit the loss to one hazard.
        Returns:
            One MapValue per state code or county FIPS. Loss metrics omit areas
            without NRI data.
        Raises:
            InvalidMapQuery: For highLossPct at county level or with a hazard, or a
                hazard with a score metric.
        Called by: routers/map_values.get_map_values.
        """
        if metric in LOSS_METRICS:
            return self._loss_map_values(level, metric, hazard)
        if hazard is not None:
            raise InvalidMapQuery("hazard only applies to loss metrics")

        snapshot = await self.get_snapshot()
        if level is MapLevel.STATE:
            composites, scores = snapshot.state_composite, snapshot.state_scores
        else:
            composites, scores = snapshot.county_composite, snapshot.county_scores

        if metric is MapMetric.COMPOSITE:
            values = composites
        else:
            hazard = Hazard(metric.value)
            values = {area: area_scores[hazard] for area, area_scores in scores.items()}
        return [MapValue(id=area, value=v, tier=tier_for(v)) for area, v in values.items()]

    async def get_state(self, code: str) -> StateRecord | None:
        """Build the detail record for one state.

        Args:
            code: Two-letter state code, upper case.
        Returns:
            The StateRecord, or None for an unknown code.
        Called by: routers/states.get_state.
        """
        state = self._reference.states.get(code)
        if state is None:
            return None
        snapshot = await self.get_snapshot()
        alerts = _unique_alerts(snapshot, state)
        composite = snapshot.state_composite[code]
        return StateRecord(
            code=code,
            name=state.name,
            composite_score=composite,
            tier=tier_for(composite),
            counties_count=len(state.county_fips),
            population=_format_population(state.population),
            active_alert_count=len(alerts) if snapshot.nws_available else None,
            primary_alert=_state_primary_alert(snapshot, state, alerts),
            hazards=self._state_hazards(snapshot, state),
            expected_loss=self._state_expected_loss(code),
        )

    async def get_county(self, fips: str) -> CountyRecord | None:
        """Build the detail record for one county.

        Adds this county's forecast and river gauge signals to its national signals, so
        its scores can differ from its map value.

        Args:
            fips: Five-digit county FIPS code.
        Returns:
            The CountyRecord, or None for an unknown FIPS code.
        Called by: routers/counties.get_county.
        """
        county = self._reference.counties.get(fips)
        if county is None:
            return None
        snapshot, conditions, gauges = await asyncio.gather(
            self.get_snapshot(), self._conditions_for(county), self._gauges_for(county)
        )

        # Start from this county's national signals and add the local ones. This
        # is why a county's detail score can differ from its map value.
        signals = dict(snapshot.signals[county.fips])
        if conditions is not None:
            for signal in _weather_signals(conditions):
                merge_signal(signals, signal)
        if gauges is not None:
            merge_signal(signals, _flood_signal(gauges, conditions))

        unavailable = _unavailable_hazards(snapshot, conditions, gauges)
        scores = {
            hazard: hazard_score(baseline, signals[hazard].score if hazard in signals else 0)
            for hazard, baseline in county.baseline_scores.items()
        }
        hazards = [
            HazardItem(
                name=hazard.label,
                score=score,
                tier=tier_for(score),
                warning=self._county_warning(county, hazard, signals, unavailable),
            )
            for hazard, score in scores.items()
        ]
        hazards.sort(key=lambda h: h.score, reverse=True)

        composite = composite_score(scores.values())
        return CountyRecord(
            name=county.name,
            state=self._reference.states[county.state_code].name,
            state_code=county.state_code,
            composite_score=composite,
            tier=tier_for(composite),
            fips=county.fips,
            pop=_format_population(county.population),
            active_alert=_county_active_alert(snapshot, county),
            hazards=hazards,
            expected_loss=self._county_expected_loss(fips),
        )

    def source_status(self) -> dict[str, Any]:
        """Summarize the cache state of each upstream source.

        Returns:
            {"nws": ..., "usgs": ..., "openMeteo": ..., "nwps": ...}, each a TTLCache.status().
        Called by: routers/health.health.
        """
        return {
            "nws": self._cache.status(NWS_KEY),
            "usgs": self._cache.status(USGS_KEY),
            "openMeteo": self._cache.status(WEATHER_PREFIX),
            "nwps": self._cache.status(GAUGES_PREFIX),
        }

    async def _build_snapshot(self) -> Snapshot:
        """Fetch the national feeds and compute a new snapshot.

        A feed that's unavailable is passed as None, and its hazards score from the
        baseline alone.

        Returns:
            A new Snapshot.
        Called by: get_snapshot, through the TTL cache.
        """
        ttl = self._settings.feeds_ttl_seconds
        alerts, quakes = await asyncio.gather(
            self._optional(NWS_KEY, self._nws.fetch_active_alerts, ttl),
            self._optional(USGS_KEY, self._usgs.fetch_recent_quakes, ttl),
        )
        return build_snapshot(self._reference, alerts, quakes)

    async def _conditions_for(self, county: County) -> Conditions | None:
        """Return a county's forecast summary, cached per county.

        Args:
            county: The county, whose centroid is the forecast point.
        Returns:
            The Conditions, or None if Open-Meteo is unavailable.
        Called by: get_county.
        """
        return await self._optional(
            f"{WEATHER_PREFIX}{county.fips}",
            lambda: self._open_meteo.fetch_conditions(county.latitude, county.longitude),
            self._settings.weather_ttl_seconds,
        )

    async def _gauges_for(self, county: County) -> list[Gauge] | None:
        """Return the river gauges in a county's bounding box, cached per county.

        Args:
            county: The county.
        Returns:
            The gauges, or None if NWPS is unavailable.
        Called by: get_county.
        """
        return await self._optional(
            f"{GAUGES_PREFIX}{county.fips}",
            lambda: self._nwps.fetch_gauges(county.bbox),
            self._settings.gauges_ttl_seconds,
        )

    async def _optional(self, key: str, fetch: Callable[[], Awaitable[Any]], ttl: int) -> Any:
        """Fetch through the cache, returning None if the source is unavailable.

        Args:
            key: Cache key.
            fetch: Async function that calls the upstream client.
            ttl: Freshness in seconds.
        Returns:
            The cached or fetched value, or None.
        Called by: _build_snapshot, _conditions_for, _gauges_for.
        """
        try:
            return await self._cache.get_or_fetch(key, fetch, ttl)
        except UpstreamUnavailable:
            return None

    def _county_warning(
        self,
        county: County,
        hazard: Hazard,
        signals: dict[Hazard, LiveSignal],
        unavailable: frozenset[Hazard],
    ) -> str:
        """Write the explanation line for one of a county's hazards.

        Args:
            county: The county.
            hazard: The hazard to explain.
            signals: The county's strongest live signal per hazard.
            unavailable: Hazards whose live source is down.
        Returns:
            The live signal's text, or else the baseline text, noting when live data is down.
        Called by: get_county.
        """
        if hazard in signals:
            return signals[hazard].text
        text = self._baseline_text(hazard, county.baseline_counts[hazard])
        return text + LIVE_UNAVAILABLE_SUFFIX if hazard in unavailable else text

    def _state_hazards(self, snapshot: Snapshot, state: State) -> list[HazardItem]:
        """Build a state's hazard list from the snapshot.

        Args:
            snapshot: The current snapshot.
            state: The state.
        Returns:
            One HazardItem per hazard, highest score first.
        Called by: get_state.
        """
        items = []
        for hazard, score in snapshot.state_scores[state.code].items():
            items.append(
                HazardItem(
                    name=hazard.label,
                    score=score,
                    tier=tier_for(score),
                    warning=self._state_warning(snapshot, state, hazard),
                )
            )
        items.sort(key=lambda h: h.score, reverse=True)
        return items

    def _state_warning(self, snapshot: Snapshot, state: State, hazard: Hazard) -> str:
        """Write the explanation line for one of a state's hazards.

        Args:
            snapshot: The current snapshot.
            state: The state.
            hazard: The hazard to explain.
        Returns:
            The strongest live signal and how many counties have it, or else the baseline text.
        Called by: _state_hazards.
        """
        signals = [
            snapshot.signals[fips][hazard]
            for fips in state.county_fips
            if hazard in snapshot.signals[fips]
        ]
        if signals:
            strongest = max(signals, key=lambda s: s.score)
            count = sum(1 for s in signals if s.text == strongest.text)
            return f"{strongest.text} ({_plural(count, 'county', 'counties')})"

        if hazard is Hazard.EARTHQUAKE:
            text = self._baseline_text(hazard, state.max_quake_count)
            if state.max_quake_count:
                text = f"Up to {text}, by county"
        else:
            text = self._baseline_text(hazard, state.declarations[hazard])
        live_source_down = (
            not snapshot.usgs_available if hazard is Hazard.EARTHQUAKE else not snapshot.nws_available
        )
        return text + LIVE_UNAVAILABLE_SUFFIX if live_source_down else text

    def _baseline_text(self, hazard: Hazard, count: int) -> str:
        """Describe a historical count, e.g. "3 federal flood declarations since 2006".

        Args:
            hazard: The hazard.
            count: Declarations, or earthquakes for the earthquake hazard.
        Returns:
            The sentence, using the baseline settings in the reference metadata.
        Called by: _county_warning, _state_warning.
        """
        meta = self._reference.meta
        since = meta["baselineSinceYear"]
        if hazard is Hazard.EARTHQUAKE:
            magnitude, radius = meta["quakeMinMagnitude"], meta["quakeRadiusMiles"]
            noun = _plural(count, f"M{magnitude}+ earthquake", f"M{magnitude}+ earthquakes")
            return f"{noun} within {radius} mi since {since}"
        label = hazard.label.lower()
        noun = _plural(count, f"federal {label} declaration", f"federal {label} declarations")
        return f"{noun} since {since}"


    def _loss_map_values(
        self, level: MapLevel, metric: MapMetric, hazard: Hazard | None
    ) -> list[MapValue]:
        """Return expected loss values per area, from the static NRI data.

        Args:
            level: States or counties.
            metric: lossPerPerson, totalLoss or highLossPct.
            hazard: Limit lossPerPerson or totalLoss to one hazard. None means all
                tracked hazards.
        Returns:
            One MapValue per area with NRI data, without a tier.
        Raises:
            InvalidMapQuery: For highLossPct at county level or with a hazard.
        Called by: get_map_values.
        """
        if metric is MapMetric.HIGH_LOSS_PCT:
            if level is MapLevel.COUNTY:
                raise InvalidMapQuery("highLossPct is only available for states")
            if hazard is not None:
                raise InvalidMapQuery("highLossPct is defined on all tracked hazards together")
            return [
                MapValue(id=code, value=round(losses.high_loss_pct, 1))
                for code, losses in self._reference.state_losses.items()
                if losses.high_loss_pct is not None
            ]

        areas = (
            self._reference.state_losses if level is MapLevel.STATE else self._reference.county_losses
        )
        values = []
        for area, losses in areas.items():
            amount = losses.by_hazard[hazard] if hazard else losses.total
            if metric is MapMetric.LOSS_PER_PERSON:
                if not losses.population:
                    continue
                amount /= losses.population
            values.append(MapValue(id=area, value=round(amount, 2)))
        return values

    def _loss_fields(self, losses: CountyLosses | StateLosses) -> dict[str, Any]:
        """Return the ExpectedLoss fields shared by counties and states.

        Args:
            losses: A county's or state's NRI losses.
        Returns:
            Keyword arguments for CountyExpectedLoss or StateExpectedLoss.
        Called by: _county_expected_loss, _state_expected_loss.
        """
        meta = self._reference.nri_meta
        by_hazard = sorted(losses.by_hazard.items(), key=lambda item: item[1], reverse=True)
        return {
            "total": round(losses.total, 2),
            "per_person": round(losses.per_person, 2) if losses.per_person is not None else None,
            "by_hazard": [HazardLoss(name=h.label, amount=round(v, 2)) for h, v in by_hazard],
            "high_loss_threshold_per_person": meta["highLossPerPersonThreshold"],
            "high_loss_percentile": meta["highLossPercentile"],
            "source": f"FEMA National Risk Index, {meta['version']}",
        }

    def _county_expected_loss(self, fips: str) -> CountyExpectedLoss | None:
        """Build a county's expected loss summary.

        Args:
            fips: Five-digit county FIPS code.
        Returns:
            The summary, or None if NRI has no data for the county.
        Called by: get_county.
        """
        losses = self._reference.county_losses.get(fips)
        if losses is None:
            return None
        threshold = self._reference.nri_meta["highLossPerPersonThreshold"]
        return CountyExpectedLoss(
            **self._loss_fields(losses),
            loss_per_person_percentile=losses.loss_per_person_percentile,
            is_high_loss=losses.per_person is not None and losses.per_person >= threshold,
            social_vulnerability=losses.social_vulnerability,
            community_resilience=losses.community_resilience,
        )

    def _state_expected_loss(self, code: str) -> StateExpectedLoss | None:
        """Build a state's expected loss summary.

        Args:
            code: Two-letter state code.
        Returns:
            The summary, or None if NRI has no data for the state.
        Called by: get_state.
        """
        losses = self._reference.state_losses.get(code)
        if losses is None:
            return None
        pct = losses.high_loss_pct
        return StateExpectedLoss(
            **self._loss_fields(losses),
            high_loss_population_pct=round(pct, 1) if pct is not None else None,
        )


def _plural(count: int, singular: str, plural: str) -> str:
    """Format a count with the right noun, e.g. "1 county" or "2,000 counties".

    Args:
        count: The number.
        singular: Noun for exactly one.
        plural: Noun for any other count.
    Returns:
        The formatted phrase.
    Called by: general utility within this module.
    """
    return f"{count:,} {singular if count == 1 else plural}"


def _format_population(population: int | None) -> str:
    """Format a population with thousands separators.

    Args:
        population: The population, or None if unknown.
    Returns:
        E.g. "2,458,395", or "N/A".
    Called by: RiskService.get_state, RiskService.get_county.
    """
    return f"{population:,}" if population is not None else UNKNOWN_POPULATION


def _weather_signals(conditions: Conditions) -> list[LiveSignal]:
    """Turn a forecast summary into wildfire and severe storm signals.

    Args:
        conditions: The county's forecast summary.
    Returns:
        Two LiveSignals. Their scores are 0 unless conditions are hazardous.
    Called by: RiskService.get_county.
    """
    humidity = f"{conditions.min_humidity_pct:.0f}%"
    gust = f"{conditions.max_gust_mph:.0f} mph"
    return [
        LiveSignal(
            Hazard.WILDFIRE,
            wildfire_weather_score(conditions.fire_advisory_hour),
            f"Next 24h: humidity as low as {humidity}, gusts to {gust}",
        ),
        LiveSignal(
            Hazard.SEVERE_STORM,
            wind_score(conditions.max_gust_mph),
            f"Next 24h: gusts to {gust}",
        ),
    ]


def _flood_signal(gauges: list[Gauge], conditions: Conditions | None) -> LiveSignal:
    """Turn nearby river gauges into a flood signal.

    Args:
        gauges: Gauges in the county's bounding box.
        conditions: The forecast summary, used to mention expected rain. May be None.
    Returns:
        A LiveSignal scored by the worst observed or forecast flood category.
    Called by: RiskService.get_county.
    """
    rain = f" · {conditions.total_precip_in:.1f} in rain next 24h" if conditions else ""

    reporting: list[tuple[int, Gauge]] = []
    for gauge in gauges:
        scores = [
            GAUGE_CATEGORY_SCORES[category]
            for category in (gauge.observed_category, gauge.forecast_category)
            if category in GAUGE_CATEGORY_SCORES
        ]
        if scores:
            reporting.append((max(scores), gauge))

    if not reporting:
        return LiveSignal(Hazard.FLOOD, 0, f"No reporting river gauges nearby{rain}")
    score, worst = max(reporting, key=lambda item: item[0])
    if score == 0:
        count = _plural(len(reporting), "nearby gauge", "nearby gauges")
        return LiveSignal(Hazard.FLOOD, 0, f"No flooding at {count}{rain}")
    return LiveSignal(Hazard.FLOOD, score, f"Elevated river stage at {worst.name}{rain}")


def _unavailable_hazards(
    snapshot: Snapshot, conditions: Conditions | None, gauges: list[Gauge] | None
) -> frozenset[Hazard]:
    """List the hazards whose live source is down for this request.

    Args:
        snapshot: The current snapshot, which records whether NWS and USGS were available.
        conditions: The forecast summary, or None if Open-Meteo was unavailable.
        gauges: The gauges, or None if NWPS was unavailable.
    Returns:
        The affected hazards.
    Called by: RiskService.get_county.
    """
    unavailable: set[Hazard] = set()
    if not snapshot.nws_available:
        unavailable |= _NWS_HAZARDS
    if not snapshot.usgs_available:
        unavailable.add(Hazard.EARTHQUAKE)
    if conditions is None:
        unavailable |= _WEATHER_HAZARDS
    if gauges is None:
        unavailable.add(Hazard.FLOOD)
    return frozenset(unavailable)


def _county_active_alert(snapshot: Snapshot, county: County) -> str | None:
    """Describe a county's most important active alert.

    Args:
        snapshot: The current snapshot.
        county: The county.
    Returns:
        The alert headline (with a count of others), ALERTS_UNKNOWN_TEXT if NWS is
        down, or None if there are no alerts.
    Called by: RiskService.get_county.
    """
    if not snapshot.nws_available:
        return ALERTS_UNKNOWN_TEXT
    alerts = snapshot.alerts.get(county.fips)
    if not alerts:
        return None
    extra = f" (+{len(alerts) - 1} more)" if len(alerts) > 1 else ""
    return f"{alerts[0].headline}{extra}"


def _unique_alerts(snapshot: Snapshot, state: State) -> list[Alert]:
    """Collect a state's active alerts, counting each alert once.

    Args:
        snapshot: The current snapshot.
        state: The state.
    Returns:
        The distinct alerts across the state's counties.
    Called by: RiskService.get_state.
    """
    unique: dict[str, Alert] = {}
    for fips in state.county_fips:
        for alert in snapshot.alerts.get(fips, []):
            unique[alert.id] = alert
    return list(unique.values())


def _state_primary_alert(snapshot: Snapshot, state: State, alerts: list[Alert]) -> str | None:
    """Describe a state's most important alert type, e.g. "Flood Warning in 3 counties".

    Args:
        snapshot: The current snapshot.
        state: The state.
        alerts: The state's distinct alerts, from _unique_alerts.
    Returns:
        The summary, ALERTS_UNKNOWN_TEXT if NWS is down, or None if there are no alerts.
    Called by: RiskService.get_state.
    """
    if not snapshot.nws_available:
        return ALERTS_UNKNOWN_TEXT
    if not alerts:
        return None
    top_event = max(alerts, key=alert_importance).event
    in_state = set(state.county_fips)
    counties = {
        fips for alert in alerts if alert.event == top_event for fips in alert.county_fips
    } & in_state
    others = sum(1 for alert in alerts if alert.event != top_event)
    extra = f" (+{_plural(others, 'other alert', 'other alerts')})" if others else ""
    return f"{top_event} in {_plural(len(counties), 'county', 'counties')}{extra}"

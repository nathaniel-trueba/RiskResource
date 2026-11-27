"""Resolves free text ("Riverside", "Palm Springs, CA", "92262") to counties.

County names are matched locally first. Anything else goes to Open-Meteo's
geocoder, which reports the county a city or ZIP code is in.
"""

import re
import unicodedata

from app.clients.open_meteo import OpenMeteoClient
from app.config import Settings
from app.core.cache import TTLCache, UpstreamUnavailable
from app.schemas import SearchResult
from app.services.reference import County, ReferenceData

GEOCODE_PREFIX = "openmeteo:geocode:"
_COUNTY_SUFFIX = re.compile(
    r"\s+(county|parish|borough|census area|municipio|municipality|city and borough)$"
)


def normalize(text: str) -> str:
    """Lowercase, remove accents and periods, and drop any county-type suffix.

    Args:
        text: A query, county name or state name.
    Returns:
        The normalized text, e.g. "Doña Ana County" gives "dona ana".
    Called by: general utility for every name comparison in this module.
    """
    decomposed = unicodedata.normalize("NFKD", text)
    ascii_text = "".join(c for c in decomposed if not unicodedata.combining(c))
    cleaned = " ".join(ascii_text.lower().replace(".", "").split())
    return _COUNTY_SUFFIX.sub("", cleaned)


def _largest_first(county: County) -> int:
    """Sort key that orders counties by population, largest first.

    Args:
        county: The county.
    Returns:
        Its negated population (0 if unknown).
    Called by: SearchService._match_counties.
    """
    return -(county.population or 0)


class SearchService:
    def __init__(
        self,
        settings: Settings,
        cache: TTLCache,
        reference: ReferenceData,
        open_meteo: OpenMeteoClient,
    ) -> None:
        """Store dependencies and build the state and county lookup tables.

        Args:
            settings: App settings, for the geocode cache lifetime.
            cache: The shared TTL cache.
            reference: Static county and state data.
            open_meteo: Client for the place geocoder.
        Called by: main.lifespan at startup.
        """
        self._settings = settings
        self._cache = cache
        self._reference = reference
        self._open_meteo = open_meteo
        self.replace_reference(reference)

    def replace_reference(self, reference: ReferenceData) -> None:
        """Use this reference data and rebuild the lookup tables from it.

        Args:
            reference: Static county and state data.
        Called by: __init__, and main.lifespan's install_reference after a refresh.
        """
        state_codes = {
            alias: code
            for code, state in reference.states.items()
            for alias in (code.lower(), normalize(state.name))
        }
        by_state_and_name = {
            (c.state_code, normalize(c.bare_name)): c for c in reference.counties.values()
        }
        # Swapped together on the event loop, so no request sees a mix.
        self._reference, self._state_codes, self._by_state_and_name = (
            reference, state_codes, by_state_and_name
        )

    async def search(self, query: str, limit: int) -> list[SearchResult]:
        """Resolve free text to counties.

        County names are matched locally first. If none match, the text is geocoded as
        a city or ZIP code.

        Args:
            query: Search text, optionally with a trailing state, e.g. "Fresno, CA".
            limit: Maximum number of results.
        Returns:
            Matching counties, best matches first. Empty if nothing matched.
        Called by: routers/search.search.
        """
        place, state_code = self._split_state(query)
        if not place:
            return []
        local = self._match_counties(place, state_code)
        if local:
            return [self._result(c) for c in local[:limit]]
        return (await self._match_places(place, state_code))[:limit]

    def _split_state(self, query: str) -> tuple[str, str | None]:
        """Separate an optional trailing state: "Fresno, CA" gives ("Fresno", "CA").

        Args:
            query: The raw search text.
        Returns:
            The place text, and the state code, or None if no state was recognized.
        Called by: search.
        """
        place, _, state_text = query.partition(",")
        return place.strip(), self._state_codes.get(normalize(state_text))

    def _match_counties(self, place: str, state_code: str | None) -> list[County]:
        """Find counties whose name matches the place text.

        Args:
            place: Place text without the state.
            state_code: Limit matches to this state, if given.
        Returns:
            Exact name matches, then prefix matches, each largest population first.
        Called by: search.
        """
        target = normalize(place)
        exact: list[County] = []
        prefix: list[County] = []
        for county in self._reference.counties.values():
            if state_code and county.state_code != state_code:
                continue
            name = normalize(county.bare_name)
            if name == target:
                exact.append(county)
            elif name.startswith(target):
                prefix.append(county)
        return sorted(exact, key=_largest_first) + sorted(prefix, key=_largest_first)

    async def _match_places(self, place: str, state_code: str | None) -> list[SearchResult]:
        """Geocode the place text and map the places found to their counties.

        Args:
            place: Place text without the state.
            state_code: Limit matches to this state, if given.
        Returns:
            One result per county, noting the place that matched. Empty if the
            geocoder is unavailable.
        Called by: search.
        """
        try:
            places = await self._cache.get_or_fetch(
                f"{GEOCODE_PREFIX}{place.lower()}",
                lambda: self._open_meteo.search_places(place),
                self._settings.geocode_ttl_seconds,
            )
        except UpstreamUnavailable:
            return []

        results: dict[str, SearchResult] = {}
        for found in places:
            code = self._state_codes.get(normalize(found.state))
            if code is None or (state_code and code != state_code):
                continue
            county = self._by_state_and_name.get((code, normalize(found.county)))
            if county and county.fips not in results:
                state_name = self._reference.states[code].name
                results[county.fips] = self._result(county, f"{found.name}, {state_name}")
        return list(results.values())

    def _result(self, county: County, matched_place: str | None = None) -> SearchResult:
        """Build the API result for a county.

        Args:
            county: The matched county.
            matched_place: The city or ZIP that led to it, if any.
        Returns:
            The SearchResult.
        Called by: search, _match_places.
        """
        return SearchResult(
            fips=county.fips,
            name=county.name,
            state=self._reference.states[county.state_code].name,
            state_code=county.state_code,
            matched_place=matched_place,
        )

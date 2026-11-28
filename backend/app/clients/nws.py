"""National Weather Service: active alerts. See docs/apis-usage.md."""

from dataclasses import dataclass

import httpx

ALERTS_URL = "https://api.weather.gov/alerts/active"


@dataclass(frozen=True)
class Alert:
    id: str
    event: str
    severity: str
    headline: str
    county_fips: tuple[str, ...]


class NwsClient:
    def __init__(self, http: httpx.AsyncClient) -> None:
        """Wrap the shared HTTP client.

        Args:
            http: The app-wide httpx client. NWS rejects requests without a User-Agent.
        Called by: main.lifespan at startup.
        """
        self._http = http

    async def fetch_active_alerts(self) -> list[Alert]:
        """Return every active US alert. One call covers the whole country.

        Returns:
            One Alert per active alert or update, including marine zones.
        Raises:
            httpx.HTTPError: On a failed request.
        Called by: RiskService._build_snapshot, through the TTL cache.
        """
        response = await self._http.get(
            ALERTS_URL, params={"status": "actual", "message_type": "alert,update"}
        )
        response.raise_for_status()
        return [_parse_alert(f["properties"]) for f in response.json()["features"]]


def _parse_alert(properties: dict) -> Alert:
    """Convert one alert's GeoJSON properties into an Alert.

    Args:
        properties: The "properties" object of one feature in the alerts response.
    Returns:
        The Alert, with county FIPS codes taken from its SAME geocodes.
    Called by: NwsClient.fetch_active_alerts.
    """
    # SAME codes are six digits: one for the county subdivision, then the five
    # digit FIPS. Marine zones also appear here, and simply match no county later.
    same_codes = (properties.get("geocode") or {}).get("SAME") or []
    return Alert(
        id=properties["id"],
        event=properties["event"],
        severity=properties.get("severity") or "Unknown",
        headline=properties.get("headline") or properties["event"],
        county_fips=tuple(code[1:] for code in same_codes),
    )

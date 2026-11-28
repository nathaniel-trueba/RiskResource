"""NOAA National Water Prediction Service: river gauges. See docs/apis-usage.md."""

import time
from dataclasses import dataclass

import httpx

GAUGES_URL = "https://api.water.noaa.gov/nwps/v1/gauges"
RATE_LIMIT_BACKOFF_SECONDS = 300


@dataclass(frozen=True)
class Gauge:
    name: str
    observed_category: str
    forecast_category: str


class NwpsClient:
    def __init__(self, http: httpx.AsyncClient) -> None:
        """Wrap the shared HTTP client.

        Args:
            http: The app-wide httpx client, which sets the User-Agent and timeout.
        Called by: main.lifespan at startup.
        """
        self._http = http
        self._rate_limited_until = 0.0

    async def fetch_gauges(self, bbox: tuple[float, float, float, float]) -> list[Gauge]:
        """Return the river gauges inside a bounding box, with their flood categories.

        Always use a box: fetching every gauge takes about 44 seconds and 13 MB. After an
        HTTP 429, every call fails fast for RATE_LIMIT_BACKOFF_SECONDS.

        Args:
            bbox: (west, south, east, north) in degrees, usually a county's bbox.
        Returns:
            One Gauge per gauge in the box (possibly empty).
        Raises:
            httpx.HTTPError: On a failed request, or while backing off from a rate limit.
        Called by: RiskService._gauges_for, through the TTL cache.
        """
        if time.monotonic() < self._rate_limited_until:
            raise httpx.HTTPError("NWPS rate limit: backing off")

        west, south, east, north = bbox
        response = await self._http.get(
            GAUGES_URL,
            params={
                "bbox.xmin": west,
                "bbox.ymin": south,
                "bbox.xmax": east,
                "bbox.ymax": north,
                "srid": "EPSG_4326",
            },
        )
        if response.status_code == 429:
            # Applies to every county, since the limit is on us rather than on one
            # request. NWPS publishes no limit and sends no Retry-After header.
            self._rate_limited_until = time.monotonic() + RATE_LIMIT_BACKOFF_SECONDS
        response.raise_for_status()
        return [_parse_gauge(g) for g in response.json().get("gauges") or []]


def _parse_gauge(gauge: dict) -> Gauge:
    """Convert one raw NWPS gauge object into a Gauge.

    Args:
        gauge: One item of the response's "gauges" list.
    Returns:
        The Gauge, with empty strings for missing flood categories.
    Called by: NwpsClient.fetch_gauges.
    """
    status = gauge.get("status") or {}
    return Gauge(
        name=gauge.get("name") or gauge["lid"],
        observed_category=(status.get("observed") or {}).get("floodCategory") or "",
        forecast_category=(status.get("forecast") or {}).get("floodCategory") or "",
    )

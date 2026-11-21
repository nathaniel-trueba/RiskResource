"""Fetch public hazard/weather APIs and upsert mapped rows into Supabase Postgres.

AWS Lambda deployment setup
---------------------------
1. Runtime: Python 3.13. Set the handler to ``lambda_function.lambda_handler``.
2. Package this file and its dependencies, including the Linux-compatible
   ``psycopg`` binary package from ``requirements.txt``.
3. Set the ``DATABASE_URL`` environment variable to the Supabase Postgres
   connection URI (prefer the Supabase session pooler URI). Do not include
   surrounding quotes. Keep the password secret; use a Secrets Manager based
   loader if you do not want it stored as a Lambda environment variable.
4. Ensure the database has the schema from ``db/schema.sql`` and enabled
   ``api_config`` rows for the APIs: ``nws_alerts``, ``usgs_earthquakes``,
   ``noaa_gauges``, ``openmeteo_geocoding``, ``openmeteo_forecast``, and
   ``nri_counties``. NWS configuration must include a valid User-Agent header.
5. Set the Lambda execution role to include basic CloudWatch Logs permissions.
   Add the function as the EventBridge schedule target and allow EventBridge to
   invoke it. The schedule input can be ``{"task":"all"}``; omit
   ``dry_run`` (or set it to false) to write fetched rows to Supabase. Use
   ``{"task":"all","dry_run":true}`` for a no-write check.
6. Set a Lambda timeout of at least 180 seconds and memory of at least 512 MB.
   If the function is attached to a VPC, provide outbound internet access
   (typically through a NAT gateway) for Supabase and the public APIs.

API endpoints, default query parameters, and headers are read from Supabase's
``api_config`` table. Public feeds do not need separate API keys by default.
"""

from __future__ import annotations

import json
import logging
import math
import os
import random
import re
import time
from datetime import datetime, timedelta, timezone
from typing import Any, Callable
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit
from urllib.request import Request, urlopen

import psycopg
from psycopg import sql
from psycopg.types.json import Jsonb


# ------------------------------- CONFIG ------------------------------------
CONFIG = {
    "lookback_hours": 24,
    "default_places": [
        "Palm Springs CA",
        "Santa Rosa CA",
        "Fresno CA",
        "San Diego CA",
        "Riverside CA",
    ],
    "chunk_size": 500,
    "request_timeout_seconds": 20,
    # The backend's NWPS client notes the nationwide gauge list can take ~44s
    # and return ~13 MB, so it needs a separate timeout and bounded retry count.
    "api_timeouts_seconds": {"noaa_gauges": 90, "nri_counties": 60},
    "api_max_retries": {"noaa_gauges": 1, "nri_counties": 2},
    "max_retries": 4,
    "backoff_base_seconds": 0.5,
    "max_backoff_seconds": 8.0,
    "nri_page_size": 2000,
    "nri_high_loss_percentile": 80,
}
COLUMNS: dict[str, tuple[str, ...]] = {
    "locations": (
        "id", "name", "country", "admin1", "latitude", "longitude",
        "timezone", "population", "fetched_at",
    ),
    "weather_observations": (
        "location_id", "observed_at", "temperature_2m", "wind_speed_10m",
        "fetched_at",
    ),
    "earthquakes": (
        "id", "magnitude", "place", "event_time", "updated_at", "latitude",
        "longitude", "depth_km", "tsunami", "url", "raw", "fetched_at",
    ),
    "weather_alerts": (
        "id", "event", "severity", "urgency", "certainty", "status",
        "headline", "description", "area_desc", "sent", "effective", "expires",
        "raw", "fetched_at",
    ),
    "gauges": (
        "lid", "name", "state", "latitude", "longitude", "raw", "fetched_at",
    ),
    "nri_meta": (
        "id", "version", "high_loss_percentile", "high_loss_per_person",
    ),
    "nri_county_profiles": (
        "county_fips", "population", "social_vulnerability", "community_resilience",
        "loss_per_person_percentile",
    ),
    "nri_county_losses": (
        "county_fips", "hazard", "expected_annual_loss",
    ),
}
PRIMARY_KEYS: dict[str, tuple[str, ...]] = {
    "locations": ("id",),
    "weather_observations": ("location_id", "observed_at"),
    "earthquakes": ("id",),
    "weather_alerts": ("id",),
    "gauges": ("lid",),
    "nri_meta": ("id",),
    "nri_county_profiles": ("county_fips",),
    "nri_county_losses": ("county_fips", "hazard"),
}
STRING_COLUMNS = {
    "locations": {"name", "country", "admin1", "timezone"},
    "weather_observations": set(),
    "earthquakes": {"id", "place", "url"},
    "weather_alerts": {
        "id", "event", "severity", "urgency", "certainty", "status",
        "headline", "description", "area_desc",
    },
    "gauges": {"lid", "name", "state"},
    "nri_meta": {"version"},
    "nri_county_profiles": {"county_fips", "social_vulnerability", "community_resilience"},
    "nri_county_losses": {"county_fips", "hazard"},
}
INTEGER_COLUMNS = {
    "locations": {"id", "population"},
    "nri_meta": {"high_loss_percentile"},
    "nri_county_profiles": {"population", "loss_per_person_percentile"},
}
BOOLEAN_COLUMNS = {"earthquakes": {"tsunami"}, "nri_meta": {"id"}}
JSON_COLUMNS = {"earthquakes": {"raw"}, "weather_alerts": {"raw"}, "gauges": {"raw"}}
TIMESTAMP_COLUMNS = {
    "locations": {"fetched_at"},
    "weather_observations": {"observed_at", "fetched_at"},
    "earthquakes": {"event_time", "updated_at", "fetched_at"},
    "weather_alerts": {"sent", "effective", "expires", "fetched_at"},
    "gauges": {"fetched_at"},
    "nri_meta": set(),
    "nri_county_profiles": set(),
    "nri_county_losses": set(),
}
FLOAT_COLUMNS = {
    "locations": {"latitude", "longitude"},
    "weather_observations": {"temperature_2m", "wind_speed_10m"},
    "earthquakes": {"magnitude", "latitude", "longitude", "depth_km"},
    "weather_alerts": set(),
    "gauges": {"latitude", "longitude"},
    "nri_meta": {"high_loss_per_person"},
    "nri_county_profiles": set(),
    "nri_county_losses": {"expected_annual_loss"},
}

# FEMA NRI hazard-code to the existing public.hazards vocabulary. These mirror
# app.domain.hazards.NRI_HAZARDS and stay inline so the Lambda is self-contained.
NRI_HAZARDS: dict[str, str] = {
    "WFIR": "wildfire",
    "ERQK": "earthquake",
    "IFLD": "flood",
    "CFLD": "flood",
    "SWND": "severeStorm",
    "HAIL": "severeStorm",
    "LTNG": "severeStorm",
    "ISTM": "severeStorm",
    "WNTW": "severeStorm",
    "HRCN": "hurricane",
    "TRND": "tornado",
}
NRI_TO_OUR_FIPS = {
    "02158": "02270",
    "46102": "46113",
    "02063": "02261",
    "02066": "02261",
}

STATE_NAMES = {
    "AL": "Alabama", "AK": "Alaska", "AZ": "Arizona", "AR": "Arkansas",
    "CA": "California", "CO": "Colorado", "CT": "Connecticut", "DE": "Delaware",
    "FL": "Florida", "GA": "Georgia", "HI": "Hawaii", "ID": "Idaho",
    "IL": "Illinois", "IN": "Indiana", "IA": "Iowa", "KS": "Kansas",
    "KY": "Kentucky", "LA": "Louisiana", "ME": "Maine", "MD": "Maryland",
    "MA": "Massachusetts", "MI": "Michigan", "MN": "Minnesota", "MS": "Mississippi",
    "MO": "Missouri", "MT": "Montana", "NE": "Nebraska", "NV": "Nevada",
    "NH": "New Hampshire", "NJ": "New Jersey", "NM": "New Mexico", "NY": "New York",
    "NC": "North Carolina", "ND": "North Dakota", "OH": "Ohio", "OK": "Oklahoma",
    "OR": "Oregon", "PA": "Pennsylvania", "RI": "Rhode Island", "SC": "South Carolina",
    "SD": "South Dakota", "TN": "Tennessee", "TX": "Texas", "UT": "Utah",
    "VT": "Vermont", "VA": "Virginia", "WA": "Washington", "WV": "West Virginia",
    "WI": "Wisconsin", "WY": "Wyoming", "DC": "District of Columbia",
}
STATE_ABBREVIATIONS = {v.casefold(): k for k, v in STATE_NAMES.items()}

LOGGER = logging.getLogger(__name__)
LOGGER.setLevel(logging.INFO)
_API_CONFIG_CACHE: dict[str, dict[str, Any]] | None = None
_LOGGED_DROPPED_KEYS: set[tuple[str, tuple[str, ...]]] = set()


class CollectorError(RuntimeError):
    """Raised when a remote request or mapped API response is unusable."""


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def _connect() -> psycopg.Connection:
    """Connect using the same DATABASE_URL settings as app.db.connect."""
    database_url = os.environ.get("DATABASE_URL", "")
    if not database_url:
        raise CollectorError("DATABASE_URL must be configured for the Supabase session pooler")
    if "[YOUR-PASSWORD]" in database_url:
        raise CollectorError("DATABASE_URL still contains the [YOUR-PASSWORD] placeholder")
    return psycopg.connect(database_url, connect_timeout=10, prepare_threshold=None)


def _encode_query(url: str, params: dict[str, Any]) -> str:
    parts = urlsplit(url)
    query = dict(parse_qsl(parts.query, keep_blank_values=True))
    query.update({k: v for k, v in params.items() if v is not None})
    return urlunsplit((parts.scheme, parts.netloc, parts.path, urlencode(query, doseq=True), parts.fragment))


def _request_json(
    url: str,
    *,
    method: str = "GET",
    headers: dict[str, str] | None = None,
    body: Any = None,
    timeout: float = CONFIG["request_timeout_seconds"],
    max_retries: int = CONFIG["max_retries"],
) -> Any:
    payload = None if body is None else json.dumps(body, separators=(",", ":")).encode("utf-8")
    request_headers = {"Accept": "application/json", "User-Agent": "Python-urllib", **(headers or {})}
    if payload is not None:
        request_headers.setdefault("Content-Type", "application/json")
    request = Request(url, data=payload, headers=request_headers, method=method)
    for attempt in range(max_retries + 1):
        try:
            with urlopen(request, timeout=timeout) as response:
                data = response.read()
            if not data:
                return None
            return json.loads(data.decode("utf-8"))
        except HTTPError as exc:
            retryable = exc.code == 429 or 500 <= exc.code <= 599
            exc.read(1000)
            if not retryable or attempt >= max_retries:
                raise CollectorError(f"HTTP {exc.code} for {urlsplit(url).path}") from exc
            retry_after = exc.headers.get("Retry-After")
            delay = _backoff(attempt, retry_after)
        except (TimeoutError, URLError) as exc:
            if attempt >= max_retries:
                reason = exc.reason if isinstance(exc, URLError) else exc
                raise CollectorError(
                    f"Request failed for {urlsplit(url).path}: {type(reason).__name__}"
                ) from exc
            delay = _backoff(attempt)
        except json.JSONDecodeError as exc:
            raise CollectorError(f"Invalid JSON from {urlsplit(url).path}") from exc
        time.sleep(delay)
    raise CollectorError("Request retry loop exhausted")


def _backoff(attempt: int, retry_after: str | None = None) -> float:
    if retry_after:
        try:
            return min(float(retry_after), CONFIG["max_backoff_seconds"])
        except ValueError:
            pass
    ceiling = min(
        CONFIG["backoff_base_seconds"] * (2**attempt), CONFIG["max_backoff_seconds"]
    )
    return random.uniform(ceiling * 0.5, ceiling)


def _load_api_config(force: bool = False) -> dict[str, dict[str, Any]]:
    global _API_CONFIG_CACHE
    if _API_CONFIG_CACHE is not None and not force:
        return _API_CONFIG_CACHE
    result: dict[str, dict[str, Any]] = {}
    try:
        with _connect() as conn:
            rows = conn.execute(
                "SELECT name, base_url, default_params, headers, enabled "
                "FROM public.api_config"
            ).fetchall()
    except (psycopg.Error, CollectorError) as exc:
        reason = str(exc) if isinstance(exc, CollectorError) else type(exc).__name__
        raise CollectorError(f"Could not read api_config from Supabase: {reason}") from exc
    for name, base_url, default_params, headers, enabled in rows:
        result[str(name)] = {
            "name": name,
            "base_url": base_url,
            "default_params": default_params or {},
            "headers": headers or {},
            "enabled": enabled,
        }
    _API_CONFIG_CACHE = result
    return result


def _api_config(name: str, configs: dict[str, dict[str, Any]]) -> dict[str, Any]:
    row = configs.get(name)
    if row is None:
        raise CollectorError(f"Required api_config row '{name}' is missing")
    if row.get("enabled") is not True:
        raise CollectorError(f"Required api_config row '{name}' is disabled")
    if not row.get("base_url"):
        raise CollectorError(f"api_config row '{name}' has no base_url")
    return row


def _api_get(
    name: str,
    configs: dict[str, dict[str, Any]],
    params: dict[str, Any] | None = None,
    *,
    url_override: str | None = None,
    timeout: float | None = None,
    max_retries: int | None = None,
) -> Any:
    config = _api_config(name, configs)
    merged = dict(config.get("default_params") or {})
    merged.update(params or {})
    return _request_json(
        _encode_query(url_override or config["base_url"], merged),
        headers=dict(config.get("headers") or {}),
        timeout=timeout or CONFIG["request_timeout_seconds"],
        max_retries=(CONFIG["max_retries"] if max_retries is None else max_retries),
    )


def _reference_quake_minimum() -> float:
    try:
        with _connect() as conn:
            row = conn.execute(
                "SELECT quake_min_magnitude FROM public.reference_meta LIMIT 1"
            ).fetchone()
        value = float(row[0]) if row else 3.0
        if math.isfinite(value):
            return value
    except (psycopg.Error, CollectorError, TypeError, ValueError, IndexError) as exc:
        LOGGER.warning(
            "reference_meta unavailable; using default quake magnitude 3.0 (%s)",
            type(exc).__name__,
        )
    return 3.0


def _iso_from_epoch_ms(value: Any) -> str | None:
    try:
        return datetime.fromtimestamp(float(value) / 1000, timezone.utc).isoformat().replace("+00:00", "Z")
    except (TypeError, ValueError, OSError, OverflowError):
        return None


def _iso_utc(value: Any, append_z: bool = False) -> str | None:
    if value is None or value == "":
        return None
    if not isinstance(value, str):
        return None
    value = value.strip()
    if append_z and not value.endswith(("Z", "z", "+00:00")):
        value += "Z"
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def _as_feature_list(payload: Any) -> list[dict[str, Any]]:
    if isinstance(payload, dict) and isinstance(payload.get("features"), list):
        return [x for x in payload["features"] if isinstance(x, dict)]
    return []


def _fetch_alert_features(configs: dict[str, dict[str, Any]], area: str | None) -> list[dict[str, Any]]:
    config = _api_config("nws_alerts", configs)
    headers = {str(k).casefold(): v for k, v in dict(config.get("headers") or {}).items()}
    if "user-agent" not in headers:
        raise CollectorError("api_config 'nws_alerts' must include the required User-Agent header")
    params = dict(config.get("default_params") or {})
    # Nationwide active snapshot by default, with an optional event-level area.
    params.pop("area", None)
    if area:
        params["area"] = area
    next_url = _encode_query(config["base_url"], params)
    seen: set[str] = set()
    features: list[dict[str, Any]] = []
    while next_url and next_url not in seen:
        seen.add(next_url)
        payload = _request_json(next_url, headers=dict(config.get("headers") or {}))
        features.extend(_as_feature_list(payload))
        pagination = payload.get("pagination") if isinstance(payload, dict) else None
        next_url = pagination.get("next") if isinstance(pagination, dict) else None
    return features


def _map_alerts(features: list[dict[str, Any]], fetched_at: str) -> list[dict[str, Any]]:
    rows = []
    for feature in features:
        props = feature.get("properties")
        if not isinstance(props, dict):
            continue
        rows.append({
            "id": props.get("id"),
            "event": props.get("event"),
            "severity": props.get("severity"),
            "urgency": props.get("urgency"),
            "certainty": props.get("certainty"),
            "status": props.get("status"),
            "headline": props.get("headline"),
            "description": props.get("description"),
            "area_desc": props.get("areaDesc"),
            "sent": props.get("sent"),
            "effective": props.get("effective"),
            "expires": props.get("expires"),
            "raw": feature,
            "fetched_at": fetched_at,
        })
    return rows


def _map_earthquakes(payload: Any, fetched_at: str) -> list[dict[str, Any]]:
    rows = []
    for feature in _as_feature_list(payload):
        props = feature.get("properties")
        geometry = feature.get("geometry")
        coords = geometry.get("coordinates") if isinstance(geometry, dict) else None
        if not isinstance(props, dict):
            continue
        if not isinstance(coords, list) or len(coords) < 3:
            coords = [None, None, None]
        tsunami_value = props.get("tsunami")
        rows.append({
            "id": feature.get("id"),
            "magnitude": props.get("mag"),
            "place": props.get("place"),
            "event_time": _iso_from_epoch_ms(props.get("time")),
            "updated_at": _iso_from_epoch_ms(props.get("updated")),
            "longitude": coords[0],
            "latitude": coords[1],
            "depth_km": coords[2],
            "tsunami": tsunami_value,
            "url": props.get("url"),
            "raw": feature,
            "fetched_at": fetched_at,
        })
    return rows


def _state_parts(place: str) -> tuple[str, str | None]:
    match = re.search(r"\b([A-Za-z]{2})\s*$", place)
    if match:
        state_code = match.group(1).upper()
        return place[:match.start()].strip(), STATE_NAMES.get(state_code, state_code)
    return place.strip(), None


def _matches_state(result: dict[str, Any], state_name: str | None) -> bool:
    if str(result.get("country_code", "")).upper() != "US":
        return False
    if not state_name:
        return True
    admin1 = str(result.get("admin1") or "").strip().casefold()
    expected = state_name.strip().casefold()
    expected_full = STATE_NAMES.get(expected.upper(), expected).casefold()
    expected_abbr = STATE_ABBREVIATIONS.get(expected, expected.upper()).casefold()
    return admin1 in {expected, expected_full, expected_abbr}


def _choose_geocode(payload: Any, state_name: str | None) -> dict[str, Any] | None:
    results = payload.get("results") if isinstance(payload, dict) else None
    if not isinstance(results, list):
        return None
    us_results = [r for r in results if isinstance(r, dict) and str(r.get("country_code", "")).upper() == "US"]
    matching = [r for r in us_results if _matches_state(r, state_name)]
    return (matching or (us_results if not state_name else []))[0] if (matching or (us_results and not state_name)) else None


def _normalize_place(place: Any) -> tuple[str, str | None]:
    if isinstance(place, dict):
        name = str(place.get("name", "")).strip()
        state = place.get("state")
        if not name:
            raise CollectorError("Each place object must include a name")
        return name, str(state).strip() if state else _state_parts(name)[1]
    if not isinstance(place, str) or not place.strip():
        raise CollectorError("Each place must be a non-empty string or {name, state} object")
    return _state_parts(place.strip())


def _map_weather(
    configs: dict[str, dict[str, Any]], places: list[Any], fetched_at: str
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    locations: list[dict[str, Any]] = []
    observations: list[dict[str, Any]] = []
    for place in places:
        place_name, state_name = _normalize_place(place)
        geo = _api_get("openmeteo_geocoding", configs, {"name": place_name})
        match = _choose_geocode(geo, state_name)
        if not match:
            raise CollectorError(f"No US geocoding result matched '{place_name}' and state '{state_name}'")
        location_id = match.get("id")
        location = {
            "id": location_id,
            "name": match.get("name"),
            "country": match.get("country"),
            "admin1": match.get("admin1"),
            "latitude": match.get("latitude"),
            "longitude": match.get("longitude"),
            "timezone": match.get("timezone"),
            "population": match.get("population"),
            "fetched_at": fetched_at,
        }
        locations.append(location)
        forecast = _api_get(
            "openmeteo_forecast",
            configs,
            {
                "latitude": match.get("latitude"),
                "longitude": match.get("longitude"),
                "current": "temperature_2m,wind_speed_10m",
                # Open-Meteo documents GMT as its UTC timezone identifier.
                "timezone": "GMT",
                "wind_speed_unit": "mph",
            },
        )
        if not isinstance(forecast, dict) or forecast.get("utc_offset_seconds") != 0:
            raise CollectorError(
                f"Open-Meteo forecast did not confirm a zero UTC offset for '{place_name}'"
            )
        current = forecast.get("current")
        if not isinstance(current, dict):
            raise CollectorError(f"Open-Meteo forecast has no current object for '{place_name}'")
        observations.append({
            "location_id": location_id,
            "observed_at": _iso_utc(current.get("time"), append_z=True),
            "temperature_2m": current.get("temperature_2m"),
            "wind_speed_10m": current.get("wind_speed_10m"),
            "fetched_at": fetched_at,
        })
    return locations, observations


def _map_gauges(payload: Any, fetched_at: str) -> list[dict[str, Any]]:
    if isinstance(payload, list):
        gauges = payload
    elif isinstance(payload, dict):
        gauges = payload.get("gauges")
    else:
        gauges = None
    if not isinstance(gauges, list):
        raise CollectorError("NOAA gauges response was neither a list nor an object with a gauges list")
    rows = []
    for gauge in gauges:
        if not isinstance(gauge, dict):
            continue
        state = gauge.get("state")
        if isinstance(state, dict):
            state = state.get("abbreviation")
        rows.append({
            "lid": gauge.get("lid"),
            "name": gauge.get("name"),
            "state": state,
            "latitude": gauge.get("latitude"),
            "longitude": gauge.get("longitude"),
            "raw": gauge,
            "fetched_at": fetched_at,
        })
    return rows


def _fetch_nri_records(configs: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
    """Fetch every NRI county-layer record using ArcGIS offset pagination."""
    fields = [
        "STCOFIPS", "STATEABBRV", "POPULATION", "NRI_VER", "SOVI_RATNG", "RESL_RATNG",
        *(f"{code}_EALT" for code in NRI_HAZARDS),
    ]
    records: list[dict[str, Any]] = []
    offset = 0
    while True:
        payload = _api_get(
            "nri_counties",
            configs,
            {
                "where": "1=1",
                "outFields": ",".join(fields),
                "returnGeometry": "false",
                "orderByFields": "OBJECTID",
                "resultOffset": offset,
                "resultRecordCount": CONFIG["nri_page_size"],
                "f": "json",
            },
            timeout=CONFIG["api_timeouts_seconds"]["nri_counties"],
            max_retries=CONFIG["api_max_retries"]["nri_counties"],
        )
        if not isinstance(payload, dict):
            raise CollectorError("NRI ArcGIS response was not a JSON object")
        if payload.get("error"):
            error = payload["error"]
            message = error.get("message", "unspecified ArcGIS error") if isinstance(error, dict) else "unspecified ArcGIS error"
            raise CollectorError(f"NRI ArcGIS query failed: {message}")
        features = payload.get("features")
        if not isinstance(features, list):
            raise CollectorError("NRI ArcGIS response did not include a features list")
        page_rows = [
            feature["attributes"]
            for feature in features
            if isinstance(feature, dict) and isinstance(feature.get("attributes"), dict)
        ]
        records.extend(page_rows)
        if not payload.get("exceededTransferLimit"):
            break
        if not page_rows:
            raise CollectorError("NRI ArcGIS pagination reported more rows but returned an empty page")
        offset += len(page_rows)
    if not records:
        raise CollectorError("NRI ArcGIS returned no county records")
    required = {"STCOFIPS", "STATEABBRV", "POPULATION", "NRI_VER", "SOVI_RATNG", "RESL_RATNG"}
    required.update(f"{code}_EALT" for code in NRI_HAZARDS)
    missing = sorted(required - records[0].keys())
    if missing:
        raise CollectorError(f"NRI records are missing expected fields: {', '.join(missing)}")
    return records


def _nri_number(value: Any, field: str, *, default: float | None = None) -> float:
    if value is None or value == "":
        if default is not None:
            return default
        raise CollectorError(f"NRI field {field} is empty")
    try:
        number = float(value)
    except (TypeError, ValueError) as exc:
        raise CollectorError(f"NRI field {field} is not numeric") from exc
    if not math.isfinite(number) or number < 0:
        raise CollectorError(f"NRI field {field} must be a finite non-negative number")
    return number


def _nri_percentile(sorted_values: list[float], percentile: int) -> float:
    """Match NumPy's default linear percentile interpolation without NumPy."""
    if not sorted_values:
        raise CollectorError("NRI has no positive-population counties for percentile calculation")
    position = (len(sorted_values) - 1) * percentile / 100
    lower = math.floor(position)
    upper = math.ceil(position)
    if lower == upper:
        return sorted_values[lower]
    fraction = position - lower
    return sorted_values[lower] + (sorted_values[upper] - sorted_values[lower]) * fraction


def _nri_rank_percentile(sorted_values: list[float], value: float) -> int:
    """Return the mid-rank percentile, matching the existing reference builder."""
    import bisect

    lower = bisect.bisect_left(sorted_values, value)
    upper = bisect.bisect_right(sorted_values, value)
    return int(round(100 * (lower + upper) / 2 / len(sorted_values)))


def _nri_rating(value: Any) -> str | None:
    if not value or value in ("Data Unavailable", "Not Applicable", "Insufficient Data"):
        return None
    return str(value)


def _map_nri_records(
    records: list[dict[str, Any]], fetched_at: str
) -> tuple[dict[str, Any], list[dict[str, Any]], list[dict[str, Any]], int]:
    """Reshape NRI rows into the existing NRI metadata and county tables."""
    supported_states = set(STATE_NAMES) | {"PR"}
    raw_per_person: list[float] = []
    version: str | None = None
    county_profiles: dict[str, dict[str, Any]] = {}
    skipped_source_rows = 0

    for record in records:
        state = str(record.get("STATEABBRV") or "").upper()
        if state not in supported_states:
            skipped_source_rows += 1
            continue
        version = version or (str(record["NRI_VER"]) if record.get("NRI_VER") else None)
        losses = {hazard: 0.0 for hazard in set(NRI_HAZARDS.values())}
        for nri_code, hazard in NRI_HAZARDS.items():
            losses[hazard] += _nri_number(
                record.get(f"{nri_code}_EALT"), f"{nri_code}_EALT", default=0.0
            )
        population_value = _nri_number(record.get("POPULATION"), "POPULATION", default=0.0)
        population = int(population_value)
        if population > 0:
            raw_per_person.append(sum(losses.values()) / population)

        # The existing county reference has no Connecticut county rows; the NRI
        # layer reports Connecticut planning regions with five-digit region codes.
        if state == "CT":
            skipped_source_rows += 1
            continue
        source_fips = str(record.get("STCOFIPS") or "").strip()
        if not source_fips.isdigit():
            skipped_source_rows += 1
            continue
        source_fips = source_fips.zfill(5)
        county_fips = NRI_TO_OUR_FIPS.get(source_fips, source_fips)
        if len(county_fips) != 5:
            skipped_source_rows += 1
            continue

        profile = county_profiles.setdefault(
            county_fips,
            {
                "population": 0,
                "losses": {hazard: 0.0 for hazard in set(NRI_HAZARDS.values())},
                "social_vulnerability": None,
                "community_resilience": None,
                "source_count": 0,
            },
        )
        profile["population"] += population
        profile["source_count"] += 1
        for hazard, amount in losses.items():
            profile["losses"][hazard] += amount
        profile["social_vulnerability"] = _nri_rating(record.get("SOVI_RATNG"))
        profile["community_resilience"] = _nri_rating(record.get("RESL_RATNG"))

    raw_per_person.sort()
    threshold = _nri_percentile(raw_per_person, CONFIG["nri_high_loss_percentile"])
    version = version or "unknown"
    meta_row = {
        "id": True,
        "version": version,
        "high_loss_percentile": CONFIG["nri_high_loss_percentile"],
        "high_loss_per_person": threshold,
    }

    profile_rows: list[dict[str, Any]] = []
    loss_rows: list[dict[str, Any]] = []
    for county_fips, profile in county_profiles.items():
        population = profile["population"]
        total_loss = sum(profile["losses"].values())
        per_person = total_loss / population if population > 0 else None
        profile_rows.append({
            "county_fips": county_fips,
            "population": population,
            "social_vulnerability": profile["social_vulnerability"] if profile["source_count"] == 1 else None,
            "community_resilience": profile["community_resilience"] if profile["source_count"] == 1 else None,
            "loss_per_person_percentile": (
                _nri_rank_percentile(raw_per_person, per_person) if per_person is not None else None
            ),
        })
        for hazard, amount in profile["losses"].items():
            loss_rows.append({
                "county_fips": county_fips,
                "hazard": hazard,
                "expected_annual_loss": round(amount, 2),
            })
    return meta_row, profile_rows, loss_rows, skipped_source_rows


def _coerce_timestamp(value: Any) -> str | None:
    if value is None:
        return None
    parsed = _iso_utc(value)
    return parsed


def _coerce_value(table: str, column: str, value: Any) -> tuple[Any, bool]:
    if value == "":
        return None, False
    if value is None:
        return None, False
    try:
        if column in STRING_COLUMNS.get(table, set()):
            return str(value), False
        if column in INTEGER_COLUMNS.get(table, set()):
            if isinstance(value, bool):
                return None, True
            number = int(value)
            return number, False
        if column in FLOAT_COLUMNS.get(table, set()):
            if isinstance(value, bool):
                return None, True
            number = float(value)
            return (number, False) if math.isfinite(number) else (None, True)
        if column in BOOLEAN_COLUMNS.get(table, set()):
            if isinstance(value, bool):
                return value, False
            if value in (0, 1, "0", "1"):
                return bool(int(value)), False
            if isinstance(value, str) and value.casefold() in {"true", "false"}:
                return value.casefold() == "true", False
            return None, True
        if column in TIMESTAMP_COLUMNS.get(table, set()):
            converted = _coerce_timestamp(value)
            return converted, converted is None
        if column in JSON_COLUMNS.get(table, set()):
            return value, False
        return value, False
    except (TypeError, ValueError, OverflowError):
        return None, True


def _sanitize_rows(
    table: str, rows: list[dict[str, Any]], metrics: dict[str, Any]
) -> list[dict[str, Any]]:
    allowed = set(COLUMNS[table])
    primary_key = PRIMARY_KEYS[table]
    sanitized = []
    dropped_keys: set[str] = set()
    dropped_count = 0
    for row in rows:
        dropped_here = {str(k) for k in row if k not in allowed}
        dropped_keys.update(dropped_here)
        dropped_count += len(dropped_here)
        clean: dict[str, Any] = {}
        for column, value in row.items():
            if column not in allowed:
                continue
            clean_value, coerced = _coerce_value(table, column, value)
            if coerced:
                metrics["null_coerced_fields"] += 1
            clean[column] = clean_value
        if any(clean.get(key) is None for key in primary_key):
            metrics["skipped_missing_primary_key"] += 1
            continue
        sanitized.append(clean)
    metrics["dropped_fields"] += dropped_count
    if dropped_keys:
        token = (table, tuple(sorted(dropped_keys)))
        if token not in _LOGGED_DROPPED_KEYS:
            LOGGER.warning("Dropped unmapped keys for %s: %s", table, ", ".join(sorted(dropped_keys)))
            _LOGGED_DROPPED_KEYS.add(token)
    return sanitized


def _dedupe_batch(rows: list[dict[str, Any]], keys: tuple[str, ...]) -> list[dict[str, Any]]:
    unique: dict[tuple[Any, ...], dict[str, Any]] = {}
    for row in rows:
        unique[tuple(row.get(k) for k in keys)] = row
    return list(unique.values())


def _upsert_rows(table: str, rows: list[dict[str, Any]]) -> int:
    if not rows:
        return 0
    keys = PRIMARY_KEYS[table]
    columns = tuple(column for column in COLUMNS[table] if column in rows[0])
    updates = tuple(column for column in columns if column not in keys)
    statement = sql.SQL(
        "INSERT INTO {} ({}) VALUES ({}) ON CONFLICT ({}) DO UPDATE SET {}"
    ).format(
        sql.Identifier("public", table),
        sql.SQL(", ").join(sql.Identifier(column) for column in columns),
        sql.SQL(", ").join(sql.Placeholder() for _ in columns),
        sql.SQL(", ").join(sql.Identifier(column) for column in keys),
        sql.SQL(", ").join(
            sql.SQL("{} = EXCLUDED.{}").format(sql.Identifier(column), sql.Identifier(column))
            for column in updates
        ),
    )
    sent = 0
    try:
        with _connect() as conn:
            for start in range(0, len(rows), CONFIG["chunk_size"]):
                batch = _dedupe_batch(rows[start : start + CONFIG["chunk_size"]], keys)
                if not batch:
                    continue
                parameters = [
                    tuple(
                        Jsonb(row[column])
                        if column in JSON_COLUMNS.get(table, set()) and row[column] is not None
                        else row[column]
                        for column in columns
                    )
                    for row in batch
                ]
                conn.executemany(statement, parameters)
                sent += len(batch)
    except psycopg.Error as exc:
        raise CollectorError(f"Could not upsert table {table}: {type(exc).__name__}") from exc
    return sent


def _table_summary(
    table: str,
    raw_rows: list[dict[str, Any]],
    event: dict[str, Any],
    fetched_at: str,
) -> dict[str, Any]:
    metrics: dict[str, Any] = {
        "source_rows": len(raw_rows),
        "skipped_missing_primary_key": 0,
        "dropped_fields": 0,
        "null_coerced_fields": 0,
    }
    rows = _sanitize_rows(table, raw_rows, metrics)
    if metrics["skipped_missing_primary_key"]:
        LOGGER.info(
            "Skipped %d %s rows missing primary-key values",
            metrics["skipped_missing_primary_key"], table,
        )
    # De-duplicate whole-table candidates as well, including keys spanning chunks.
    rows = _dedupe_batch(rows, PRIMARY_KEYS[table])
    all_null_columns = [
        column for column in COLUMNS[table]
        if rows and all(row.get(column) is None for row in rows)
    ]
    sample = rows[0] if rows else None
    if event.get("dry_run") is True:
        written = 0
        LOGGER.info(
            "Dry run table=%s mapped_rows=%d sample=%s metrics=%s",
            table, len(rows), json.dumps(sample, default=str), json.dumps(metrics),
        )
    else:
        written = _upsert_rows(table, rows)
    return {
        "rows_written": written,
        "mapped_rows": len(rows),
        "skipped": metrics["skipped_missing_primary_key"],
        "dropped_fields": metrics["dropped_fields"],
        "null_coerced_fields": metrics["null_coerced_fields"],
        "all_null_columns": all_null_columns,
        "example_row": sample if event.get("dry_run") is True else None,
    }


def _task_alerts(
    event: dict[str, Any], configs: dict[str, dict[str, Any]], fetched_at: str
) -> dict[str, Any]:
    features = _fetch_alert_features(configs, event.get("area"))
    rows = _map_alerts(features, fetched_at)
    return {"weather_alerts": _table_summary("weather_alerts", rows, event, fetched_at)}


def _task_earthquakes(
    event: dict[str, Any], configs: dict[str, dict[str, Any]], fetched_at: str
) -> dict[str, Any]:
    minimum = _reference_quake_minimum()
    lookback = float(event.get("lookback_hours", CONFIG["lookback_hours"]))
    if lookback <= 0:
        raise CollectorError("lookback_hours must be greater than zero")
    now = datetime.now(timezone.utc)
    payload = _api_get(
        "usgs_earthquakes",
        configs,
        {
            "starttime": (now - timedelta(hours=lookback)).isoformat().replace("+00:00", "Z"),
            "endtime": now.isoformat().replace("+00:00", "Z"),
            "minmagnitude": minimum,
            "orderby": "time",
        },
    )
    rows = _map_earthquakes(payload, fetched_at)
    return {"earthquakes": _table_summary("earthquakes", rows, event, fetched_at)}


def _task_gauges(
    event: dict[str, Any], configs: dict[str, dict[str, Any]], fetched_at: str
) -> dict[str, Any]:
    payload = _api_get(
        "noaa_gauges",
        configs,
        timeout=CONFIG["api_timeouts_seconds"]["noaa_gauges"],
        max_retries=CONFIG["api_max_retries"]["noaa_gauges"],
    )
    rows = _map_gauges(payload, fetched_at)
    return {"gauges": _table_summary("gauges", rows, event, fetched_at)}


def _task_weather(
    event: dict[str, Any], configs: dict[str, dict[str, Any]], fetched_at: str
) -> dict[str, Any]:
    places = event.get("places", CONFIG["default_places"])
    if not isinstance(places, list) or not places:
        raise CollectorError("places must be a non-empty list")
    locations, observations = _map_weather(configs, places, fetched_at)
    return {
        "locations": _table_summary("locations", locations, event, fetched_at),
        "weather_observations": _table_summary(
            "weather_observations", observations, event, fetched_at
        ),
    }


def _task_nri(
    event: dict[str, Any], configs: dict[str, dict[str, Any]], fetched_at: str
) -> dict[str, Any]:
    """Fetch the complete NRI layer and upsert existing NRI metadata/county tables."""
    source_records = _fetch_nri_records(configs)
    meta, profiles, losses, skipped_source_rows = _map_nri_records(source_records, fetched_at)
    profile_result = _table_summary("nri_county_profiles", profiles, event, fetched_at)
    loss_result = _table_summary("nri_county_losses", losses, event, fetched_at)
    # Write metadata after county rows so failed county upserts don't advertise a
    # new NRI version before its county data has been loaded.
    meta_result = _table_summary("nri_meta", [meta], event, fetched_at)
    # Unsupported territories and Connecticut planning-region features don't map to
    # county rows in the existing schema; expose that count in both county summaries.
    for result in (profile_result, loss_result):
        result["source_rows_skipped"] = skipped_source_rows
        result["skipped"] += skipped_source_rows
    return {
        "nri_meta": meta_result,
        "nri_county_profiles": profile_result,
        "nri_county_losses": loss_result,
    }


TASKS: dict[str, Callable[..., dict[str, Any]]] = {
    "alerts": _task_alerts,
    "earthquakes": _task_earthquakes,
    "gauges": _task_gauges,
    "weather": _task_weather,
    "nri": _task_nri,
}


def lambda_handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    """Route scheduled jobs independently and return a JSON-safe run summary."""
    started = time.monotonic()
    _LOGGED_DROPPED_KEYS.clear()
    event = event if isinstance(event, dict) else {}
    requested = event.get("task", "all")
    if requested not in {"alerts", "earthquakes", "gauges", "weather", "nri", "all"}:
        return {
            "error": "task must be alerts, earthquakes, gauges, weather, nri, or all",
            "task": requested,
            "rows_written": {},
            "skipped": {},
            "durations_seconds": {},
            "errors": {str(requested): "Unsupported task"},
        }
    task_names = list(TASKS) if requested == "all" else [requested]
    summary: dict[str, Any] = {
        "request_id": getattr(context, "aws_request_id", None),
        "task": requested,
        "started_at": _now_iso(),
        "dry_run": event.get("dry_run") is True,
        "tasks": {},
        "rows_written": {},
        "skipped": {},
        "durations_seconds": {},
        "errors": {},
    }
    try:
        configs = _load_api_config()
    except Exception as exc:  # shared failure; reported independently for requested tasks
        for name in task_names:
            summary["errors"][name] = str(exc)
            summary["durations_seconds"][name] = 0.0
        summary["duration_seconds"] = round(time.monotonic() - started, 3)
        return summary

    for name in task_names:
        task_started = time.monotonic()
        try:
            table_results = TASKS[name](event, configs, _now_iso())
            summary["tasks"][name] = table_results
            summary["rows_written"][name] = {
                table: detail["rows_written"] for table, detail in table_results.items()
            }
            summary["skipped"][name] = {
                table: detail["skipped"] for table, detail in table_results.items()
            }
        except Exception as exc:
            LOGGER.exception("Task %s failed", name)
            summary["errors"][name] = str(exc)
            summary["rows_written"].setdefault(name, {})
            summary["skipped"].setdefault(name, {})
        summary["durations_seconds"][name] = round(time.monotonic() - task_started, 3)

    summary["duration_seconds"] = round(time.monotonic() - started, 3)
    return summary

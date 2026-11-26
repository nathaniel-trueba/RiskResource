"""Archive active NWS alerts into Supabase, with a configurable retention window.

What it does, each run:
  1. Reads the nws_alerts row of public.api_config (URL, parameters, User-Agent).
  2. Fetches every active NWS alert in the US (one request, following pagination).
  3. Keeps alerts that cover at least one county in public.counties (the backend's
     reference data, the source of truth), and stores only the useful fields in
     public.nws_alert_archive: no raw response, no description text.
  4. Records the run time in public.archive_settings.last_run_at.
  5. Deletes alerts issued more than archive_settings.retention_days ago (365 by
     default; edit it in Supabase's Table Editor).

Why: NWS's API only serves alerts that are active now. This builds a history per
county, and gives the backend a recent copy to show when it can't reach NWS
(app/services/alert_archive.py). The backend still calls NWS itself for live data.

AWS Lambda deployment setup
---------------------------
1. Runtime: Python 3.13. Handler: ``lambda_function.lambda_handler``.
2. Package this file with ``psycopg[binary]`` (Linux build) from requirements.txt.
3. Environment: ``DATABASE_URL``, the Supabase session pooler URI, without quotes.
   Use Secrets Manager instead if you don't want it stored as a Lambda variable.
4. The database needs db/migrations/2026-11-26_nws_alert_archive.sql applied (or a
   fresh db/schema.sql), and an enabled api_config row named ``nws_alerts`` whose
   headers include a User-Agent. NWS rejects requests without one.
5. Schedule: an EventBridge rule, ``rate(15 minutes)`` recommended. Many tornado and
   severe thunderstorm warnings last under an hour, so hourly runs miss them, and
   the backend's fallback is only as fresh as the last run. Input ``{}`` is fine;
   ``{"dry_run": true}`` fetches and maps without writing.
6. Timeout 60 seconds, memory 256 MB. Runs take a few seconds. If attached to a VPC,
   it needs outbound internet (NAT gateway) for Supabase and NWS.
7. CloudWatch: set the log group /aws/lambda/<function> to keep logs 30 days.
"""

from __future__ import annotations

import json
import logging
import os
import random
import time
from datetime import datetime, timezone
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit
from urllib.request import Request, urlopen

import psycopg

# ------------------------------- CONFIG ------------------------------------
CONFIG = {
    "api_name": "nws_alerts",  # The api_config row this function uses
    "archive_table": "nws_alert_archive",  # Its row in archive_settings
    # Matches the backend's own NWS query (app/clients/nws.py). An api_config
    # default_params entry with the same key overrides these.
    "default_params": {"status": "actual", "message_type": "alert,update"},
    "request_timeout_seconds": 20,
    "max_retries": 4,
    "backoff_base_seconds": 0.5,
    "max_backoff_seconds": 8.0,
    "chunk_size": 500,
}

LOGGER = logging.getLogger(__name__)
LOGGER.setLevel(logging.INFO)


class CollectorError(RuntimeError):
    """Raised when a remote request or a response is unusable."""


# ------------------------------- HTTP --------------------------------------


def _encode_query(url: str, params: dict[str, Any]) -> str:
    """Merge query parameters into a URL, keeping any already in it."""
    parts = urlsplit(url)
    query = dict(parse_qsl(parts.query, keep_blank_values=True))
    query.update({k: v for k, v in params.items() if v is not None})
    return urlunsplit((parts.scheme, parts.netloc, parts.path, urlencode(query, doseq=True), parts.fragment))


def _backoff(attempt: int, retry_after: str | None = None) -> float:
    """Seconds to wait before a retry: Retry-After if given, else jittered exponential."""
    if retry_after:
        try:
            return min(float(retry_after), CONFIG["max_backoff_seconds"])
        except ValueError:
            pass
    ceiling = min(CONFIG["backoff_base_seconds"] * (2**attempt), CONFIG["max_backoff_seconds"])
    return random.uniform(ceiling * 0.5, ceiling)


def _request_json(url: str, headers: dict[str, str]) -> Any:
    """GET JSON, retrying 429s, 5xx errors, timeouts and network errors."""
    request = Request(
        url, headers={"Accept": "application/geo+json", "User-Agent": "Python-urllib", **headers}
    )
    for attempt in range(CONFIG["max_retries"] + 1):
        try:
            with urlopen(request, timeout=CONFIG["request_timeout_seconds"]) as response:
                data = response.read()
            return json.loads(data.decode("utf-8")) if data else None
        except HTTPError as exc:
            retryable = exc.code == 429 or 500 <= exc.code <= 599
            exc.read(1000)
            if not retryable or attempt >= CONFIG["max_retries"]:
                raise CollectorError(f"HTTP {exc.code} for {urlsplit(url).path}") from exc
            delay = _backoff(attempt, exc.headers.get("Retry-After"))
        except (TimeoutError, URLError) as exc:
            if attempt >= CONFIG["max_retries"]:
                reason = exc.reason if isinstance(exc, URLError) else exc
                raise CollectorError(f"Request failed for {urlsplit(url).path}: {type(reason).__name__}") from exc
            delay = _backoff(attempt)
        except json.JSONDecodeError as exc:
            raise CollectorError(f"Invalid JSON from {urlsplit(url).path}") from exc
        time.sleep(delay)
    raise CollectorError("Request retry loop exhausted")


# ------------------------------- Database ----------------------------------


def _connect() -> psycopg.Connection:
    """Connect using the same DATABASE_URL settings as app.db.connect."""
    database_url = os.environ.get("DATABASE_URL", "")
    if not database_url:
        raise CollectorError("DATABASE_URL must be configured for the Supabase session pooler")
    if "[YOUR-PASSWORD]" in database_url:
        raise CollectorError("DATABASE_URL still contains the [YOUR-PASSWORD] placeholder")
    return psycopg.connect(database_url, connect_timeout=10, prepare_threshold=None)


def _load_inputs(conn: psycopg.Connection) -> tuple[dict[str, Any], set[str]]:
    """Read the nws_alerts api_config row and the set of county FIPS codes."""
    row = conn.execute(
        "SELECT base_url, default_params, headers, enabled FROM public.api_config WHERE name = %s",
        (CONFIG["api_name"],),
    ).fetchone()
    if row is None:
        raise CollectorError(f"Required api_config row '{CONFIG['api_name']}' is missing")
    base_url, default_params, headers, enabled = row
    if enabled is not True:
        raise CollectorError(f"api_config row '{CONFIG['api_name']}' is disabled")
    if not base_url:
        raise CollectorError(f"api_config row '{CONFIG['api_name']}' has no base_url")
    headers = dict(headers or {})
    if "user-agent" not in {str(k).casefold() for k in headers}:
        raise CollectorError(f"api_config row '{CONFIG['api_name']}' must include a User-Agent header")
    counties = {fips.strip() for (fips,) in conn.execute("SELECT fips FROM public.counties")}
    if not counties:
        raise CollectorError("public.counties is empty; start the backend once to seed it")
    config = {
        "base_url": base_url,
        "params": {**CONFIG["default_params"], **dict(default_params or {})},
        "headers": headers,
    }
    return config, counties


# ------------------------------- Alerts ------------------------------------


def _fetch_alerts(config: dict[str, Any]) -> list[dict[str, Any]]:
    """Fetch every active alert, following NWS pagination if present."""
    next_url: str | None = _encode_query(config["base_url"], config["params"])
    seen: set[str] = set()
    features: list[dict[str, Any]] = []
    while next_url and next_url not in seen:
        seen.add(next_url)
        payload = _request_json(next_url, config["headers"])
        if isinstance(payload, dict) and isinstance(payload.get("features"), list):
            features.extend(f for f in payload["features"] if isinstance(f, dict))
        pagination = payload.get("pagination") if isinstance(payload, dict) else None
        next_url = pagination.get("next") if isinstance(pagination, dict) else None
    return features


def _timestamp(value: Any) -> str | None:
    """Normalize an NWS timestamp to UTC ISO 8601, or None if missing or invalid."""
    if not isinstance(value, str) or not value.strip():
        return None
    try:
        parsed = datetime.fromisoformat(value.strip().replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc).isoformat()


def _map_alerts(
    features: list[dict[str, Any]], counties: set[str], run_at: str
) -> tuple[list[dict[str, Any]], dict[str, int]]:
    """Keep alerts covering a county, as archive rows.

    SAME geocodes are "0" followed by the 5-digit county FIPS. Codes that aren't a
    county (marine zones, whole states) are dropped, and an alert with none left
    isn't stored.
    """
    rows: dict[str, dict[str, Any]] = {}
    skipped = {"no_county": 0, "missing_fields": 0}
    for feature in features:
        props = feature.get("properties")
        if not isinstance(props, dict):
            skipped["missing_fields"] += 1
            continue
        same = (props.get("geocode") or {}).get("SAME") or []
        fips = sorted({code[1:] for code in same if isinstance(code, str) and code[1:] in counties})
        if not fips:
            skipped["no_county"] += 1
            continue
        alert_id, event, sent = props.get("id"), props.get("event"), _timestamp(props.get("sent"))
        if not alert_id or not event or not sent:
            skipped["missing_fields"] += 1
            continue
        rows[alert_id] = {
            "id": alert_id,
            "event": event,
            "severity": props.get("severity"),
            "urgency": props.get("urgency"),
            "certainty": props.get("certainty"),
            "message_type": props.get("messageType"),
            "headline": props.get("headline"),
            "area_desc": props.get("areaDesc"),
            "county_fips": fips,
            "sent": sent,
            "effective": _timestamp(props.get("effective")),
            "expires": _timestamp(props.get("expires")),
            "ends": _timestamp(props.get("ends")),
            "first_seen_at": run_at,
            "last_seen_at": run_at,
        }
    return list(rows.values()), skipped


_COLUMNS = (
    "id", "event", "severity", "urgency", "certainty", "message_type", "headline", "area_desc",
    "county_fips", "sent", "effective", "expires", "ends", "first_seen_at", "last_seen_at",
)
# first_seen_at is only set on insert; everything else is refreshed each run.
_UPSERT = (
    f"INSERT INTO public.nws_alert_archive ({', '.join(_COLUMNS)}) "
    f"VALUES ({', '.join(['%s'] * len(_COLUMNS))}) "
    "ON CONFLICT (id) DO UPDATE SET "
    + ", ".join(f"{c} = EXCLUDED.{c}" for c in _COLUMNS if c not in ("id", "first_seen_at"))
)
_PURGE = """
DELETE FROM public.nws_alert_archive
WHERE sent < now() - make_interval(days => (
  SELECT retention_days FROM public.archive_settings WHERE table_name = %s
))
"""


def _write(conn: psycopg.Connection, rows: list[dict[str, Any]], run_at: str) -> tuple[int, int | None]:
    """Upsert the rows, record the run, and apply retention, in one transaction.

    Returns:
        (rows written, rows deleted by retention). Deleted is None when there's no
        archive_settings row, in which case nothing is deleted.
    """
    with conn.transaction():
        with conn.cursor() as cur:
            for start in range(0, len(rows), CONFIG["chunk_size"]):
                batch = rows[start : start + CONFIG["chunk_size"]]
                cur.executemany(_UPSERT, [tuple(r[c] for c in _COLUMNS) for r in batch])
            cur.execute(
                "UPDATE public.archive_settings SET last_run_at = %s, updated_at = now() "
                "WHERE table_name = %s",
                (run_at, CONFIG["archive_table"]),
            )
            if cur.rowcount == 0:
                LOGGER.warning(
                    "No archive_settings row for %s: retention not applied, last_run_at not recorded",
                    CONFIG["archive_table"],
                )
                return len(rows), None
            cur.execute(_PURGE, (CONFIG["archive_table"],))
            return len(rows), cur.rowcount


# ------------------------------- Handler -----------------------------------


def lambda_handler(event: dict[str, Any] | None, context: Any) -> dict[str, Any]:
    """Fetch active NWS alerts, archive the county ones, and apply retention.

    Args:
        event: Optional {"dry_run": true} to fetch and map without writing.
        context: The Lambda context.
    Returns:
        A JSON-safe run summary. Failures raise, so the run shows as failed in
        CloudWatch and EventBridge, rather than looking like a quiet success.
    """
    started = time.monotonic()
    event = event if isinstance(event, dict) else {}
    dry_run = event.get("dry_run") is True
    run_at = datetime.now(timezone.utc).isoformat(timespec="seconds")

    with _connect() as conn:
        config, counties = _load_inputs(conn)
        features = _fetch_alerts(config)
        rows, skipped = _map_alerts(features, counties, run_at)
        written, deleted = (0, 0) if dry_run else _write(conn, rows, run_at)

    summary = {
        "request_id": getattr(context, "aws_request_id", None),
        "run_at": run_at,
        "dry_run": dry_run,
        "alerts_fetched": len(features),
        "alerts_archived": written if not dry_run else len(rows),
        "skipped": skipped,
        "deleted_by_retention": deleted,
        "duration_seconds": round(time.monotonic() - started, 3),
    }
    if dry_run and rows:
        summary["example_row"] = rows[0]
    LOGGER.info("Run summary: %s", json.dumps(summary, default=str))
    return summary

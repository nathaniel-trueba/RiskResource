"""Fallback alerts from the NWS alert archive, for when the API can't reach NWS.

The AWS Lambda (aws/lambda_function.py) copies active NWS alerts into
public.nws_alert_archive on a schedule and records each run in
public.archive_settings.last_run_at. When the live NWS fetch fails and the
in-memory cache has nothing usable, RiskService asks this module for the alerts
that were active at the Lambda's last run.

This is the only database read after startup, and it only happens during an NWS
outage, once per snapshot rebuild (every minute), in a worker thread. Requests
themselves never wait on it.
"""

import logging
from dataclasses import dataclass
from datetime import datetime

from app.clients.nws import Alert
from app.config import Settings
from app.db import connect

logger = logging.getLogger(__name__)

ARCHIVE_TABLE = "nws_alert_archive"

# Alerts seen in the last run that are still in effect. Rows from earlier runs
# were cancelled or replaced since, so they're left out.
_LATEST_ALERTS = """
SELECT id, event, coalesce(severity, 'Unknown'), coalesce(headline, event), county_fips
FROM public.nws_alert_archive
WHERE last_seen_at = %(run_at)s
  AND (expires IS NULL OR expires > now())
  AND (ends IS NULL OR ends > now())
"""


@dataclass(frozen=True)
class ArchivedAlerts:
    alerts: list[Alert]
    as_of: datetime  # The Lambda run they came from


def load_archived_alerts(settings: Settings) -> ArchivedAlerts | None:
    """Return the alerts from the Lambda's last run, if it's recent enough.

    Blocking (psycopg), so call it in a worker thread.

    Args:
        settings: For DATABASE_URL and alert_archive_max_age_minutes.
    Returns:
        ArchivedAlerts (possibly with no alerts, meaning none were active at that
        run), or None if the archive is unreachable, the Lambda hasn't run, or its
        last run is older than alert_archive_max_age_minutes.
    Called by: RiskService._build_snapshot, when the live NWS feed is unavailable.
    """
    try:
        with connect(settings) as conn:
            row = conn.execute(
                "SELECT last_run_at FROM public.archive_settings "
                "WHERE table_name = %s AND last_run_at > now() - make_interval(mins => %s)",
                (ARCHIVE_TABLE, settings.alert_archive_max_age_minutes),
            ).fetchone()
            if row is None:
                logger.warning(
                    "NWS alert archive has no run in the last %d minutes; alerts stay unavailable",
                    settings.alert_archive_max_age_minutes,
                )
                return None
            (run_at,) = row
            alerts = [
                Alert(id=i, event=e, severity=s, headline=h, county_fips=tuple(f))
                for i, e, s, h, f in conn.execute(_LATEST_ALERTS, {"run_at": run_at})
            ]
    except Exception as error:  # noqa: BLE001 - a second failure mustn't break scoring
        logger.warning("Couldn't read the NWS alert archive: %s", error)
        return None
    logger.info("NWS unavailable; using %d archived alerts from %s", len(alerts), run_at.isoformat())
    return ArchivedAlerts(alerts=alerts, as_of=run_at)

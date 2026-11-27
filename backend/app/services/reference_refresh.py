"""Keeps the reference data current by rebuilding it when it gets old.

The reference data (counties, disaster history since 2006, FEMA's National Risk
Index, population) is built by scripts/build_reference_data.py and stored in
Supabase. Without this, it only changes when someone runs
`python -m scripts.init_db --refresh` by hand.

There's no clock-based schedule, because every Railway deploy restarts the process
and would reset it. Instead, a background task checks every
REFERENCE_CHECK_INTERVAL_SECONDS (an hour) how old the data is, from
reference_meta.generated_at in the database. Once it's more than
REFERENCE_MAX_AGE_DAYS (30) old, the task rebuilds it from the public sources,
replaces the tables, and hands the new data to the running services. Restarts
don't matter, because the age lives in the database.

Safety:
- The rebuild downloads everything before writing anything. If a source fails, the
  old data stays and the next check tries again.
- The tables are replaced in one transaction (db.initialize), so readers see either
  the old data or the new.
- A session advisory lock, plus a second age check once it's held, means only one
  process rebuilds, even if several backends share the database.
- data/reference.json isn't rewritten. It only seeds an empty database; the
  database is the source of truth.
"""

import asyncio
import logging
from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from typing import Any

from app.config import Settings
from app.db import connect, initialize
from app.services.reference import ReferenceData

logger = logging.getLogger(__name__)

# Separate from db._INIT_LOCK_ID, which initialize() takes inside its transaction.
_REFRESH_LOCK_ID = 727_401_002
# Wait this long after startup before the first check, so it never slows startup.
FIRST_CHECK_DELAY_SECONDS = 60


def _generated_at(reference: ReferenceData) -> datetime | None:
    """When this reference data was built, from its metadata, or None if unknown."""
    value = reference.meta.get("generatedAt")
    return datetime.fromisoformat(value) if value else None


class ReferenceRefresher:
    def __init__(
        self,
        settings: Settings,
        on_refresh: Callable[[ReferenceData], None],
        current: ReferenceData,
    ) -> None:
        """Store settings and the callback that installs new reference data.

        Args:
            settings: App settings, for the database URL and the age and interval limits.
            on_refresh: Called on the event loop with the newly loaded ReferenceData.
            current: The data loaded at startup, for its build date.
        Called by: main.lifespan at startup.
        """
        self._settings = settings
        self._on_refresh = on_refresh
        self._last_check: datetime | None = None
        self._last_refresh: datetime | None = None
        self._generated_at: datetime | None = _generated_at(current)
        self._last_error: str | None = None

    @property
    def enabled(self) -> bool:
        """Whether automatic refreshes are on (REFERENCE_MAX_AGE_DAYS above 0)."""
        return self._settings.reference_max_age_days > 0

    async def run_forever(self) -> None:
        """Check the data's age on a timer, refreshing it when it's too old.

        Never raises: a failed check or rebuild is logged and retried next interval.
        Called by: main.lifespan, as a background task that's cancelled at shutdown.
        """
        if not self.enabled:
            logger.info("Reference refresh: off (REFERENCE_MAX_AGE_DAYS=0)")
            return
        await asyncio.sleep(FIRST_CHECK_DELAY_SECONDS)
        while True:
            await self.check_once()
            await asyncio.sleep(self._settings.reference_check_interval_seconds)

    async def check_once(self) -> bool:
        """Run one age check, and a refresh if the data is too old.

        Returns:
            True if the reference data was rebuilt and installed.
        Called by: run_forever.
        """
        self._last_check = datetime.now(UTC)
        try:
            reference = await asyncio.to_thread(self._refresh_if_stale)
        except Exception as exc:  # Any failure leaves the old data in place
            self._last_error = f"{type(exc).__name__}: {exc}"
            logger.exception("Reference refresh failed; keeping the current data")
            return False
        self._last_error = None
        if reference is None:
            return False
        self._on_refresh(reference)
        self._last_refresh = datetime.now(UTC)
        logger.info("Reference refresh: installed data generated at %s", self._generated_at)
        return True

    def _refresh_if_stale(self) -> ReferenceData | None:
        """Rebuild and reseed the reference data if it's older than the limit.

        Runs in a worker thread: the downloads and psycopg's sync API block.

        Returns:
            The new ReferenceData, or None if the data is recent enough or another
            process holds the refresh lock.
        Raises:
            httpx.HTTPError: If a source fails during the rebuild. Nothing is written.
            psycopg.Error: If the database fails. The transaction rolls back.
        Called by: check_once.
        """
        from scripts.build_reference_data import build  # Only needed when refreshing

        with connect(self._settings) as conn:
            conn.autocommit = True  # So the session lock isn't tied to a transaction
            if not self._is_stale(conn):
                return None
            got_lock = conn.execute("SELECT pg_try_advisory_lock(%s)", (_REFRESH_LOCK_ID,)).fetchone()[0]
            if not got_lock:
                logger.info("Reference refresh: another process is already refreshing")
                return None
            try:
                if not self._is_stale(conn):  # Someone else may have finished meanwhile
                    return None
                logger.info("Reference refresh: data is older than %d days; rebuilding",
                            self._settings.reference_max_age_days)
                data = build()
                initialize(conn, self._settings.reference_data_path, reseed_with=data)
                self._read_generated_at(conn)
                return ReferenceData.from_database(conn)
            finally:
                conn.execute("SELECT pg_advisory_unlock(%s)", (_REFRESH_LOCK_ID,))

    def _read_generated_at(self, conn) -> datetime | None:
        """Read and remember when the stored reference data was built."""
        row = conn.execute("SELECT generated_at FROM public.reference_meta LIMIT 1").fetchone()
        self._generated_at = row[0] if row else None
        return self._generated_at

    def _is_stale(self, conn) -> bool:
        """Whether the stored data is older than REFERENCE_MAX_AGE_DAYS, or has no date."""
        generated_at = self._read_generated_at(conn)
        if generated_at is None:
            return True
        return datetime.now(UTC) - generated_at > timedelta(days=self._settings.reference_max_age_days)

    def status(self) -> dict[str, Any]:
        """Summarize the refresher for /api/health.

        Returns:
            {"enabled", "maxAgeDays", "generatedAt", "nextRefreshAfter", "lastCheck",
            "lastRefresh", "error"}, with times as ISO strings or None.
        Called by: routers/health.health.
        """
        def iso(value: datetime | None) -> str | None:
            return value.isoformat(timespec="seconds") if value else None

        max_age = self._settings.reference_max_age_days
        next_after = self._generated_at + timedelta(days=max_age) if self._generated_at else None
        return {
            "enabled": self.enabled,
            "maxAgeDays": max_age,
            "generatedAt": iso(self._generated_at),
            "nextRefreshAfter": iso(next_after) if self.enabled else None,
            "lastCheck": iso(self._last_check),
            "lastRefresh": iso(self._last_refresh),
            "error": self._last_error,
        }

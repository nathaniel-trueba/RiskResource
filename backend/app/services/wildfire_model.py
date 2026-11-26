"""Serves the wildfire model's weekly county scores to the snapshot.

The API never runs the model (that needs xgboost, pandas and about 180 days of
NASA POWER weather per grid cell). A weekly job writes one WeeklyScores document
(see weekly_scores/contract.py) to WILDFIRE_MODEL_URI, a local file now and an S3
object after the AWS migration, and this module reads it from there.

The document is re-read whenever its version token changes (a file's mtime, an S3
object's ETag), so a new week is picked up without a restart. A document whose
week is more than `max_age_days` old is ignored, so an old forecast is never
presented as this week's.
"""

import logging
import threading
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from typing import Any

from app.domain.scoring import wildfire_model_score
from weekly_scores import ScoresStore, WeeklyScores

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class WildfireModelScores:
    week_start: date
    generated_at: str | None
    probabilities: dict[str, float]  # By county FIPS, calibrated weekly probability
    scores: dict[str, int]  # By county FIPS, wildfire_model_score of the probability


class WildfireModelSource:
    def __init__(self, store: ScoresStore, max_age_days: int) -> None:
        """Remember where the weekly document is. Nothing is read until current() is called.

        Args:
            store: Where the weekly job writes (weekly_scores.open_store).
            max_age_days: Days after weekStart that the document still counts.
        Called by: main.lifespan at startup.
        """
        self._store = store
        self._max_age = timedelta(days=max_age_days)
        self._lock = threading.Lock()
        self._version: str | None = None
        self._loaded: WildfireModelScores | None = None
        self._error: str | None = None

    def current(self, today: date | None = None) -> WildfireModelScores | None:
        """Return this week's model scores, or None if there's no usable document.

        Checks the version token and re-reads the document if it changed. This can
        do network I/O when the store is S3, so call it from a worker thread. A
        document that's missing, unreadable or too old gives None, and the overall
        score then uses the hazard composite alone (scoring.overall_score). If a
        check fails, the last good document is kept until it goes stale.

        Args:
            today: Date to judge staleness against. Defaults to today (UTC).
        Returns:
            The WildfireModelScores, or None.
        Called by: RiskService._build_snapshot, in a worker thread.
        """
        with self._lock:
            self._reload_if_changed()
            loaded = self._loaded
        return loaded if loaded is not None and self._is_fresh(loaded, today) else None

    def status(self) -> dict[str, Any]:
        """Summarize the last check for /api/health, without touching the store.

        Returns:
            {"location", "available", "weekStart", "generatedAt", "counties", "error"}.
            "available" is False when the document is missing, unreadable or stale.
        Called by: RiskService.source_status.
        """
        loaded = self._loaded
        return {
            "location": self._store.describe(),
            "available": loaded is not None and self._is_fresh(loaded, None),
            "weekStart": loaded.week_start.isoformat() if loaded else None,
            "generatedAt": loaded.generated_at if loaded else None,
            "counties": len(loaded.scores) if loaded else 0,
            "error": self._error,
        }

    def _is_fresh(self, loaded: WildfireModelScores, today: date | None) -> bool:
        """Whether a loaded document's week is recent enough to use.

        Args:
            loaded: The document.
            today: Date to compare against, or None for today (UTC).
        Returns:
            True if today is at most max_age_days after its weekStart.
        Called by: current, status.
        """
        today = today or datetime.now(UTC).date()
        return today - loaded.week_start <= self._max_age

    def _reload_if_changed(self) -> None:
        """Read the document again if it appeared, changed or disappeared since the last check.

        Returns:
            None. Updates _version, _loaded and _error. Call with _lock held.
        Called by: current.
        """
        try:
            version = self._store.version()
        except Exception as error:  # noqa: BLE001 - e.g. S3 unreachable; keep the last good copy
            logger.warning("Couldn't check %s: %s", self._store.describe(), error)
            self._error = f"check failed: {error}"
            return
        if version is None:
            if self._version is not None or self._error is None:
                logger.warning(
                    "No wildfire model scores at %s; overall scores exclude the model",
                    self._store.describe(),
                )
            self._version, self._loaded, self._error = None, None, "not found"
            return
        if version == self._version:
            return
        try:
            self._loaded = _score(WeeklyScores.from_json(self._store.read()))
            self._version, self._error = version, None
            logger.info(
                "Loaded wildfire model scores for the week of %s (%d counties) from %s",
                self._loaded.week_start,
                len(self._loaded.scores),
                self._store.describe(),
            )
        except Exception as error:  # noqa: BLE001 - a bad document mustn't break scoring
            logger.error("Couldn't read %s: %s", self._store.describe(), error)
            self._version, self._loaded, self._error = version, None, str(error)


def _score(document: WeeklyScores) -> WildfireModelScores:
    """Turn the job's probabilities into the API's 0 to 100 model scores.

    Args:
        document: The validated weekly document.
    Returns:
        WildfireModelScores.
    Called by: WildfireModelSource._reload_if_changed.
    """
    return WildfireModelScores(
        week_start=document.week_start,
        generated_at=document.generated_at,
        probabilities=document.probabilities,
        scores={fips: wildfire_model_score(p) for fips, p in document.probabilities.items()},
    )

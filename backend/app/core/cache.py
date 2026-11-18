"""In-memory TTL cache that can fall back to recent data when an upstream fails.

This is a single-process cache, which is all a demo needs. It keeps upstream
usage low, because every site visitor shares this backend's API quotas.
"""

import asyncio
import logging
import time
from collections import defaultdict
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any

import httpx

logger = logging.getLogger(__name__)

# What a failed upstream call can raise: network or HTTP errors, or a response
# body that doesn't have the shape the client parses.
UPSTREAM_FAILURES = (httpx.HTTPError, ValueError, KeyError, TypeError, AttributeError)


class UpstreamUnavailable(Exception):
    """An upstream call failed and no recent enough data is cached."""


@dataclass
class _Entry:
    value: Any = None
    has_value: bool = False
    fetched_at: float = 0.0
    failed_at: float | None = None
    last_error: str | None = None


class TTLCache:
    def __init__(self, max_stale_seconds: int, failure_cooldown_seconds: int) -> None:
        """Create an empty cache.

        Args:
            max_stale_seconds: How old a value may be and still be served after a failure.
            failure_cooldown_seconds: How long to wait after a failure before retrying a key.
        Called by: main.lifespan at startup.
        """
        self._max_stale = max_stale_seconds
        self._cooldown = failure_cooldown_seconds
        self._entries: dict[str, _Entry] = {}
        # One lock per key, so concurrent requests share a single upstream call.
        self._locks: defaultdict[str, asyncio.Lock] = defaultdict(asyncio.Lock)

    async def get_or_fetch(
        self, key: str, fetch: Callable[[], Awaitable[Any]], ttl_seconds: int
    ) -> Any:
        """Return the cached value for a key, calling `fetch` if it has expired.

        Concurrent callers for the same key share one fetch. If the fetch fails, or the
        key is in its failure cooldown, recent data is served instead when there is some.

        Args:
            key: Cache key. Its prefix groups it for status() (e.g. "nwps:gauges:").
            fetch: Async function that gets a fresh value from upstream.
            ttl_seconds: How long a fetched value stays fresh.
        Returns:
            The fresh or recent cached value.
        Raises:
            UpstreamUnavailable: If the fetch fails and nothing recent enough is cached.
        Called by: general utility for every upstream call (RiskService, SearchService).
        """
        entry = self._entries.get(key)
        if entry and entry.has_value and self._age(entry) < ttl_seconds:
            return entry.value

        async with self._locks[key]:
            entry = self._entries.setdefault(key, _Entry())
            if entry.has_value and self._age(entry) < ttl_seconds:
                return entry.value

            in_cooldown = (
                entry.failed_at is not None
                and time.monotonic() - entry.failed_at < self._cooldown
            )
            if in_cooldown:
                return self._stale_or_raise(key, entry)

            try:
                value = await fetch()
            except UPSTREAM_FAILURES as exc:
                entry.failed_at = time.monotonic()
                entry.last_error = f"{type(exc).__name__}: {exc}"
                logger.warning("Upstream fetch failed for %s: %s", key, entry.last_error)
                return self._stale_or_raise(key, entry)

            entry.value = value
            entry.has_value = True
            entry.fetched_at = time.monotonic()
            entry.failed_at = None
            entry.last_error = None
            return value

    def status(self, prefix: str) -> dict[str, Any]:
        """Summarize all cache keys starting with `prefix`, for the health endpoint.

        Args:
            prefix: A full key or key prefix, e.g. "nws:alerts" or "openmeteo:forecast:".
        Returns:
            {"status": "ok" | "degraded" | "not_fetched_yet", "ageSeconds": ..., "lastError": ...}
        Called by: RiskService.source_status.
        """
        entries = [e for key, e in self._entries.items() if key.startswith(prefix)]
        if not entries:
            return {"status": "not_fetched_yet"}
        ages = [self._age(e) for e in entries if e.has_value]
        errors = [e.last_error for e in entries if e.last_error]
        result: dict[str, Any] = {
            "status": "degraded" if errors else "ok",
            "ageSeconds": round(min(ages)) if ages else None,
        }
        if errors:
            result["lastError"] = errors[-1]
        return result

    def _stale_or_raise(self, key: str, entry: _Entry) -> Any:
        """Return an entry's old value if it's within max_stale, else raise.

        Args:
            key: The entry's key, used in the exception.
            entry: The cache entry after a failed or skipped fetch.
        Returns:
            The entry's last good value.
        Raises:
            UpstreamUnavailable: If there is no value or it's too old.
        Called by: TTLCache.get_or_fetch.
        """
        if entry.has_value and self._age(entry) < self._max_stale:
            return entry.value
        raise UpstreamUnavailable(key)

    @staticmethod
    def _age(entry: _Entry) -> float:
        """Return how many seconds ago an entry was last fetched successfully.

        Args:
            entry: Any cache entry.
        Returns:
            Age in seconds, on the monotonic clock.
        Called by: TTLCache.get_or_fetch, TTLCache.status, TTLCache._stale_or_raise.
        """
        return time.monotonic() - entry.fetched_at

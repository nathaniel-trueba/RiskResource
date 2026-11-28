"""Fixed state scores for the home page's hazard map animation.

The home page shows a fixed snapshot rather than live scores, so its colours stay
stable whatever is happening today. The snapshot lives in data/snapshot/:

    hazards-<date>-snapshot.json    State scores per hazard, saved from
                                    GET /api/map-values?level=state&metric=<hazard>
                                    on that date. These are the same hazard scores
                                    the risk map shows with that hazard selected
                                    (for wildfire, the hazard score without the
                                    weekly model).

To update it, drop in a newer file. The newest one (by name) is used, and the
date shown comes from inside the file.
"""

import json
import logging
from pathlib import Path

from app.domain.scoring import tier_for
from app.schemas import HomeSnapshot, MapValue, SnapshotLayer

logger = logging.getLogger(__name__)

HAZARDS_PATTERN = "hazards-*-snapshot.json"


def _newest(directory: Path, pattern: str) -> Path | None:
    """Return the last file matching pattern, by name, or None if there are none."""
    matches = sorted(directory.glob(pattern))
    return matches[-1] if matches else None


def _hazard_layers(path: Path) -> dict[str, SnapshotLayer]:
    """Read saved state scores for each hazard.

    Args:
        path: A hazards snapshot file: {"asOf": "YYYY-MM-DD", "hazards": {hazard: [{id, value}]}}.
    Returns:
        One layer per hazard in the file, all dated asOf.
    Called by: load_home_snapshot.
    """
    raw = json.loads(path.read_text(encoding="utf-8"))
    return {
        hazard: SnapshotLayer(
            kind="day",
            as_of=raw["asOf"],
            values=[
                MapValue(id=v["id"], value=v["value"], tier=tier_for(round(v["value"]))) for v in rows
            ],
        )
        for hazard, rows in raw["hazards"].items()
    }


def load_home_snapshot(directory: Path) -> HomeSnapshot | None:
    """Load the home page snapshot. A missing or broken file never stops the API.

    Args:
        directory: The snapshot folder, normally backend/data/snapshot.
    Returns:
        The snapshot, or None if no file could be read (logged as a warning).
    Called by: main.lifespan at startup.
    """
    path = _newest(directory, HAZARDS_PATTERN)
    if path is None:
        logger.warning("Home snapshot: no %s in %s", HAZARDS_PATTERN, directory)
        return None
    try:
        layers = _hazard_layers(path)
    except (OSError, ValueError, KeyError, TypeError) as exc:
        logger.warning("Home snapshot: couldn't read %s: %s", path.name, exc)
        return None
    logger.info("Home snapshot: loaded %s", path.name)
    return HomeSnapshot(hazards=layers) if layers else None

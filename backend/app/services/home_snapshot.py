"""Fixed state scores for the home page's hazard map animation.

The home page shows a fixed snapshot rather than live scores, so its colours stay
stable whatever is happening today. The snapshot lives in data/snapshot/:

    wildfire-<week>-snapshot.json    A weekly wildfire model document (the same
                                     format as S3's wildfire/latest.json). State
                                     scores are computed from it at startup.
    hazards-<date>-snapshot.json     State scores for the other hazards, saved
                                     from GET /api/map-values on that date.

To update it, drop in a newer file of either kind. The newest file of each kind
(by name) is used, and the dates shown come from inside the files.
"""

import json
import logging
from pathlib import Path

from app.domain.scoring import tier_for, wildfire_model_score
from app.schemas import HomeSnapshot, MapValue, SnapshotLayer
from app.services.reference import ReferenceData
from app.services.snapshot import _population_weighted_model
from weekly_scores import WeeklyScores

logger = logging.getLogger(__name__)

WILDFIRE_PATTERN = "wildfire-*-snapshot.json"
HAZARDS_PATTERN = "hazards-*-snapshot.json"


def _newest(directory: Path, pattern: str) -> Path | None:
    """Return the last file matching pattern, by name, or None if there are none."""
    matches = sorted(directory.glob(pattern))
    return matches[-1] if matches else None


def _wildfire_layer(path: Path, reference: ReferenceData) -> SnapshotLayer:
    """Score each state from a weekly wildfire model document.

    Uses the same steps as the live snapshot: each county's probability becomes a
    0 to 100 model score, then counties are population-weighted into states.

    Args:
        path: A weekly scores JSON file.
        reference: Static data, for each state's counties and their populations.
    Returns:
        The week's layer, one value per state that has any scored county.
    Called by: load_home_snapshot.
    """
    scores = WeeklyScores.from_json(path.read_bytes())
    county_model = {fips: wildfire_model_score(p) for fips, p in scores.probabilities.items()}
    values = []
    for code, state in reference.states.items():
        score = _population_weighted_model(reference, state.county_fips, county_model)
        if score is not None:
            values.append(MapValue(id=code, value=score, tier=tier_for(score)))
    return SnapshotLayer(kind="week", as_of=scores.week_start, values=values)


def _hazard_layers(path: Path) -> dict[str, SnapshotLayer]:
    """Read saved state scores for the other hazards.

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


def load_home_snapshot(directory: Path, reference: ReferenceData) -> HomeSnapshot | None:
    """Load the home page snapshot. A missing or broken file never stops the API.

    Args:
        directory: The snapshot folder, normally backend/data/snapshot.
        reference: Static data, for scoring the wildfire file by state.
    Returns:
        The snapshot, or None if neither file could be read (logged as a warning).
    Called by: main.lifespan at startup.
    """
    layers: dict[str, SnapshotLayer] = {}
    for pattern, build in (
        (HAZARDS_PATTERN, _hazard_layers),
        (WILDFIRE_PATTERN, lambda p: {"wildfire": _wildfire_layer(p, reference)}),
    ):
        path = _newest(directory, pattern)
        if path is None:
            logger.warning("Home snapshot: no %s in %s", pattern, directory)
            continue
        try:
            layers.update(build(path))
            logger.info("Home snapshot: loaded %s", path.name)
        except (OSError, ValueError, KeyError, TypeError) as exc:
            logger.warning("Home snapshot: couldn't read %s: %s", path.name, exc)
    return HomeSnapshot(hazards=layers) if layers else None

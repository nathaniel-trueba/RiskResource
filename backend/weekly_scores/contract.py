"""The weekly wildfire scores document: its fields, JSON encoding and validation.

    {
      "schemaVersion": 1,
      "weekStart": "2026-11-23",                  # The Monday the week starts
      "generatedAt": "2026-11-23T14:02:11+00:00",
      "modelTrainedAt": "2026-11-21T19:17:50+00:00",
      "probabilities": {"06065": 0.00142, ...}    # By county FIPS, 0 to 1
    }

It holds probabilities, not 0 to 100 scores. Turning a probability into a score
is a scoring rule, so it lives in the API (app/domain/scoring.py) and can change
without re-running the job.

Change the format only by adding optional fields, or by bumping SCHEMA_VERSION
and teaching from_json the old version too, because the job and the API may be
deployed separately.
"""

import json
import math
from dataclasses import dataclass, field
from datetime import date
from typing import Any

SCHEMA_VERSION = 1


@dataclass(frozen=True)
class WeeklyScores:
    week_start: date
    probabilities: dict[str, float]  # By county FIPS, calibrated weekly probability
    generated_at: str | None = None  # ISO timestamp
    model_trained_at: str | None = None
    schema_version: int = field(default=SCHEMA_VERSION)

    def to_json(self) -> bytes:
        """Encode the document as compact UTF-8 JSON.

        Returns:
            The bytes to store.
        Called by: ml/wildfire/predict_week.publish.
        """
        return json.dumps(
            {
                "schemaVersion": self.schema_version,
                "weekStart": self.week_start.isoformat(),
                "generatedAt": self.generated_at,
                "modelTrainedAt": self.model_trained_at,
                "probabilities": self.probabilities,
            },
            separators=(",", ":"),
        ).encode("utf-8")

    @classmethod
    def from_json(cls, data: bytes | str) -> "WeeklyScores":
        """Decode and validate a stored document.

        Files without schemaVersion are read as version 1. Probabilities that are
        missing, not finite or outside 0 to 1 are dropped, so those counties fall
        back to the hazard composite.

        Args:
            data: The stored bytes or text.
        Returns:
            The WeeklyScores.
        Raises:
            ValueError: If the JSON is invalid, a required field is missing or
                malformed, or the schema version is newer than this code knows.
        Called by: app/services/wildfire_model.WildfireModelSource.
        """
        try:
            raw: dict[str, Any] = json.loads(data)
            version = int(raw.get("schemaVersion", 1))
            if version > SCHEMA_VERSION:
                raise ValueError(f"schemaVersion {version} is newer than supported ({SCHEMA_VERSION})")
            probabilities = {}
            for fips, p in raw["probabilities"].items():
                if p is None:
                    continue
                p = float(p)
                if math.isfinite(p) and 0.0 <= p <= 1.0:
                    probabilities[str(fips)] = p
            return cls(
                week_start=date.fromisoformat(raw["weekStart"]),
                probabilities=probabilities,
                generated_at=raw.get("generatedAt"),
                model_trained_at=raw.get("modelTrainedAt"),
                schema_version=version,
            )
        except (KeyError, TypeError, AttributeError) as error:
            raise ValueError(f"Malformed weekly scores document: {error!r}") from error

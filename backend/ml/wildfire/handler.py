"""AWS entry point for the weekly wildfire job: score_week, then publish.

Meant for an EventBridge schedule (for example `cron(0 6 ? * MON *)`, Mondays 06:00
UTC). It does exactly what `python -m ml.wildfire.predict_week` does, so the
command line and AWS can't drift apart.

Environment:
    WILDFIRE_MODEL_URI   Where to publish, e.g. s3://my-bucket/wildfire/latest.json.
                         The API's WILDFIRE_MODEL_URI must point at the same place.
    WILDFIRE_CACHE_DIR   Scratch space for weather downloads. On Lambda, /tmp/wildfire.

Event (all optional):
    {"week": "2026-11-23"}            Score that Monday instead of the current week
    {"output": "s3://..."}            Override WILDFIRE_MODEL_URI for this run
    EventBridge's own "time" field    Used to pick the week when "week" is absent

Packaging: ship backend/ml/, backend/weekly_scores/ and requirements-ml.txt plus
boto3. app/ isn't needed. The artifacts in ml/wildfire/artifacts/ are about 6 MB.

Runtime: about 30 minutes, almost all of it the ~1,900 NASA POWER downloads at 60
a minute. That's over Lambda's 15-minute limit, so either run this on a container
service with no limit (ECS Fargate scheduled task, SageMaker Processing job, AWS
Batch) or split the downloads across invocations. The handler signature works for
Lambda; on a container, run `python -m ml.wildfire.predict_week` instead.
"""

import logging
import os
from datetime import date, datetime
from pathlib import Path
from typing import Any

from ml.wildfire.config import BACKEND_DIR
from ml.wildfire.model import WildfireModel
from ml.wildfire.predict_week import LIVE_DIR, current_week_start, output_location, publish, score_week
from weekly_scores import open_store

logger = logging.getLogger(__name__)
logging.getLogger().setLevel(logging.INFO)

# Loaded once per container and reused across warm invocations.
_model: WildfireModel | None = None


def _week_from_event(event: dict[str, Any]) -> date | None:
    """Pick the week to score from the invocation event.

    Args:
        event: The Lambda event: a manual {"week": ...}, or an EventBridge
            scheduled event with an ISO "time".
    Returns:
        A Monday, or None to let score_week use the current week.
    Raises:
        ValueError: If "week" or "time" isn't an ISO date or timestamp.
    Called by: lambda_handler.
    """
    if event.get("week"):
        return date.fromisoformat(event["week"])
    if event.get("time"):
        fired = datetime.fromisoformat(event["time"].replace("Z", "+00:00")).date()
        return current_week_start(fired)
    return None


def lambda_handler(event: dict[str, Any] | None, context: Any) -> dict[str, Any]:
    """Score one week and publish it.

    Args:
        event: See the module docstring. May be None or empty.
        context: The Lambda context (unused).
    Returns:
        {"weekStart", "counties", "output"}, which shows up in the invocation result.
    Raises:
        ValueError: If the week isn't a Monday or nothing could be scored. The run
            then fails visibly (CloudWatch, EventBridge retries) instead of
            publishing a partial week.
    Called by: AWS Lambda, or anything that wants the job as a function call.
    """
    global _model
    event = event or {}
    _model = _model or WildfireModel.load()
    scores = score_week(
        _week_from_event(event),
        model=_model,
        cache_dir=Path(os.environ.get("WILDFIRE_CACHE_DIR", LIVE_DIR)),
    )
    store = open_store(output_location(event.get("output")), base_dir=BACKEND_DIR)
    publish(scores, store)
    return {
        "weekStart": scores.week_start.isoformat(),
        "counties": len(scores.probabilities),
        "output": store.describe(),
    }

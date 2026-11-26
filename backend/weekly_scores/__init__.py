"""The hand-off between the weekly wildfire job and the API.

The job (ml/wildfire/predict_week.py, or its AWS handler) writes one WeeklyScores
document; the API (app/services/wildfire_model.py) reads it. Neither imports the
other. This package is that boundary, and depends only on the standard library
(plus boto3, imported only when an s3:// location is used), so both sides can
ship it: the API without the ML dependencies, and the job without FastAPI.

    contract.py  The document's format and validation
    store.py     Where it lives: a local file now, S3 after the AWS migration
"""

from weekly_scores.contract import SCHEMA_VERSION, WeeklyScores
from weekly_scores.store import LocalFileStore, S3Store, ScoresStore, open_store

__all__ = ["SCHEMA_VERSION", "LocalFileStore", "S3Store", "ScoresStore", "WeeklyScores", "open_store"]

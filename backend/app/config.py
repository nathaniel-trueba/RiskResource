"""Application settings, overridable through environment variables or backend/.env."""

from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=BACKEND_DIR / ".env", extra="ignore")

    # Sent on every upstream request. NWS rejects requests without one.
    user_agent: str = "UCSD-Risk-Resource-NotForProfit"
    cors_origins: list[str] = ["http://localhost:3000", "http://127.0.0.1:3000"]
    upstream_timeout_seconds: float = 15.0
    # Postgres connection string for Supabase's session pooler. See env.example.
    database_url: str | None = None
    # Snapshot that seeds an empty database. Rebuilt by scripts/init_db.py --refresh.
    reference_data_path: Path = BACKEND_DIR / "data" / "reference.json"
    # Where the weekly wildfire job writes its county probabilities: a file path
    # (relative paths are under backend/) or s3://bucket/key. Must match the job's
    # WILDFIRE_MODEL_URI. Re-read whenever it changes. See weekly_scores/store.py.
    # Production sets s3://riskresource-data-bucket/wildfire/latest.json. The local
    # default is git-ignored: run predict_week to create it, or the overall score
    # leaves the model out.
    wildfire_model_uri: str = "data/wildfire_model.json"
    # Days after the file's weekStart that it still counts. After this, the overall
    # score leaves the model out rather than use an old week's forecast.
    wildfire_model_max_age_days: int = 13
    # Fixed scores for the home page's map animation. See services/home_snapshot.py.
    home_snapshot_dir: str = "data/snapshot"
    # When NWS is unreachable, show alerts from the Lambda's archive if its last run
    # is at most this old. Keep it a bit above the Lambda's schedule: 90 for hourly
    # runs, 30 for every 15 minutes. See services/alert_archive.py.
    alert_archive_max_age_minutes: int = 90

    # Cache lifetimes
    feeds_ttl_seconds: int = 300  # NWS alerts and USGS recent earthquakes
    snapshot_ttl_seconds: int = 60  # Recomputed national scores
    weather_ttl_seconds: int = 1800  # Open-Meteo, per county
    gauges_ttl_seconds: int = 900  # NWPS, per county
    geocode_ttl_seconds: int = 86400  # Open-Meteo geocoding, per query

    # How long old data may be served when an upstream call fails. After this,
    # a source counts as unavailable so we never present old alerts as current.
    max_stale_seconds: int = 3600
    # After a failure, wait this long before calling that upstream again.
    failure_cooldown_seconds: int = 60


@lru_cache
def get_settings() -> Settings:
    """Return the app settings, read once from the environment and backend/.env.

    Returns:
        The cached Settings instance.
    Called by: general utility, used at startup (main.py) and by the scripts.
    """
    return Settings()

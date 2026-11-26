"""Scores every county for one week and publishes the result for the API.

From backend/, with the ML dependencies installed:

    python -m ml.wildfire.predict_week                    # This week (Monday on or before today)
    python -m ml.wildfire.predict_week --week 2026-11-23  # A specific Monday
    python -m ml.wildfire.predict_week --output s3://bucket/wildfire/latest.json

The work is split so it can move to AWS (an EventBridge schedule) unchanged:

    score_week()  Fetch weather and run the model. Returns a WeeklyScores. No output I/O.
    publish()     Write a WeeklyScores to a store (weekly_scores.open_store).
    main()        This command line.
    ml/wildfire/handler.py   The same two steps behind a lambda_handler(event, context).

Where it's written comes from --output, else WILDFIRE_MODEL_URI, else
backend/data/wildfire_model.json. The API reads the same location (its own
WILDFIRE_MODEL_URI) and re-reads it when it changes, so no restart is needed. The overall threat score is
40% historical, 40% live and 20% this model (app/domain/scoring.py); while the file is
missing or more than WILDFIRE_MODEL_MAX_AGE_DAYS old, the API leaves the model out.

Weather, per NASA POWER grid cell:
- The 180 days before the week, and any days of the week that have already happened,
  come from NASA POWER, the same source the model was trained on. POWER's near-real-time
  data lags a few days.
- Any day POWER doesn't have yet (that lag, and the rest of the week) is filled from the
  Open-Meteo forecast, mapped onto POWER's variables. Soil wetness has no forecast, so
  those days are left missing; only the 7 days before the week use it, and XGBoost
  treats missing values the way it learned to.

The forecast has different biases from the reanalysis the model learned on (see the
README, "Using the model"), so scores are approximate. Counties whose cell has no
weather for the week are left out of the file, and fall back to the hazard composite.

Output: a WeeklyScores document (weekly_scores/contract.py).
"""

import argparse
import logging
import os
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import UTC, date, datetime, timedelta
from pathlib import Path

import numpy as np
import pandas as pd

from ml.wildfire import sources
from ml.wildfire.config import BACKEND_DIR, DATA_DIR
from ml.wildfire.model import WildfireModel
from weekly_scores import ScoresStore, WeeklyScores, open_store

logger = logging.getLogger(__name__)

# Where results go when neither --output nor WILDFIRE_MODEL_URI is set. Relative
# to backend/, the same default the API reads.
DEFAULT_OUTPUT = "data/wildfire_model.json"
# Cached POWER downloads per run. Git-ignored with data/. On AWS Lambda, set
# WILDFIRE_CACHE_DIR to somewhere under /tmp.
LIVE_DIR = DATA_DIR / "live"

# Days of weather the features need before the week (see model.features_for_week).
HISTORY_DAYS = 180

FORECAST_URL = "https://api.open-meteo.com/v1/forecast"
# Open-Meteo daily variable for each POWER parameter it can stand in for.
FORECAST_VARIABLES = {
    "T2M_MAX": "temperature_2m_max",
    "T2MDEW": "dew_point_2m_mean",
    "RH2M": "relative_humidity_2m_mean",
    "WS10M_MAX": "wind_speed_10m_max",
    "PRECTOTCORR": "precipitation_sum",
}
FORECAST_BATCH = 50  # Locations per Open-Meteo request
# Seconds between Open-Meteo requests. A 50-location, ~3-week request counts as about
# 75 calls against its 600-a-minute free limit, so 8 a minute stays under it.
FORECAST_INTERVAL_SECONDS = 8
# The forecast API serves at most this many past days, so earlier gaps stay missing.
FORECAST_PAST_DAYS = 92


def current_week_start(today: date) -> date:
    """Return the Monday on or before a date.

    Args:
        today: Any date.
    Returns:
        That week's Monday.
    Called by: score_week, handler.lambda_handler.
    """
    return today - timedelta(days=today.weekday())


def fetch_power(
    cells: pd.DataFrame, start: date, end: date, workers: int, per_minute: float, cache_dir: Path
) -> dict[str, pd.DataFrame]:
    """Download (or read from this run's cache) POWER weather for every cell.

    Args:
        cells: DataFrame indexed by cell id, with cell_lat and cell_lon.
        start: First date.
        end: Last date, inclusive. Should not be after today.
        workers: Concurrent requests.
        per_minute: Most request starts per minute, across all workers.
        cache_dir: Folder for this run's downloads, so a re-run only fetches what failed.
    Returns:
        {cell id: DataFrame indexed by date, one column per POWER parameter}. Cells
        that failed after retries are missing; they're logged.
    Called by: score_week.
    """
    cache = cache_dir / f"power_{start:%Y%m%d}_{end:%Y%m%d}"
    cache.mkdir(parents=True, exist_ok=True)
    frames: dict[str, pd.DataFrame] = {}
    todo = []
    for cell, row in cells.iterrows():
        path = cache / f"{cell}.parquet"
        if path.exists():
            frames[cell] = pd.read_parquet(path)
        else:
            todo.append((cell, row.cell_lat, row.cell_lon))
    logger.info("NASA POWER: %d of %d cells to download (%s to %s)", len(todo), len(cells), start, end)
    if not todo:
        return frames

    pacer = sources._Pacer(60 / per_minute)

    def work(cell: str, lat: float, lon: float) -> pd.DataFrame:
        """Download one cell and cache it atomically. Runs on a worker thread."""
        frame = sources.fetch_power_cell(client, lat, lon, start=start, end=end, pacer=pacer)
        tmp = cache / f"{cell}.tmp"
        frame.to_parquet(tmp)
        tmp.replace(cache / f"{cell}.parquet")
        return frame

    failed = 0
    with sources._client() as client, ThreadPoolExecutor(workers) as pool:
        futures = {pool.submit(work, *item): item[0] for item in todo}
        for done, future in enumerate(as_completed(futures), 1):
            cell = futures[future]
            try:
                frames[cell] = future.result()
            except Exception as error:  # noqa: BLE001 - keep going, report at the end
                failed += 1
                logger.error("POWER cell %s failed: %s", cell, error)
            if done % 100 == 0:
                logger.info("NASA POWER: %d / %d cells", done, len(todo))
    if failed:
        logger.warning("%d POWER cells failed; re-run to retry only those", failed)
    return frames


def fetch_forecast(cells: pd.DataFrame, start: date, end: date) -> dict[str, pd.DataFrame]:
    """Fetch Open-Meteo daily weather for every cell, named like POWER's parameters.

    Args:
        cells: DataFrame indexed by cell id, with cell_lat and cell_lon.
        start: First date (at most FORECAST_PAST_DAYS before today).
        end: Last date, inclusive (at most 15 days after today).
    Returns:
        {cell id: DataFrame indexed by date, columns in FORECAST_VARIABLES' keys}.
        Batches that failed are missing; they're logged.
    Called by: score_week.
    """
    frames: dict[str, pd.DataFrame] = {}
    pacer = sources._Pacer(FORECAST_INTERVAL_SECONDS)
    ids = list(cells.index)
    with sources._client() as client:
        for offset in range(0, len(ids), FORECAST_BATCH):
            batch = ids[offset : offset + FORECAST_BATCH]
            params = {
                "latitude": ",".join(f"{cells.at[c, 'cell_lat']:.4f}" for c in batch),
                "longitude": ",".join(f"{cells.at[c, 'cell_lon']:.4f}" for c in batch),
                "daily": ",".join(FORECAST_VARIABLES.values()),
                "wind_speed_unit": "ms",  # POWER's WS10M_MAX is in m/s
                "timezone": "GMT",
                "start_date": start.isoformat(),
                "end_date": end.isoformat(),
            }
            try:
                data = sources._get_json(client, FORECAST_URL, params, pacer=pacer)
            except Exception as error:  # noqa: BLE001 - those cells keep their gaps
                logger.error("Open-Meteo batch at %d failed: %s", offset, error)
                continue
            # One location gives an object, several give a list, in request order.
            results = data if isinstance(data, list) else [data]
            for cell, result in zip(batch, results, strict=True):
                daily = result["daily"]
                frame = pd.DataFrame(
                    {power: daily[name] for power, name in FORECAST_VARIABLES.items()},
                    index=pd.to_datetime(daily["time"]),
                    dtype="float32",
                )
                frame.index.name = "date"
                frames[cell] = frame
            logger.info("Open-Meteo: %d / %d cells", min(offset + FORECAST_BATCH, len(ids)), len(ids))
    return frames


def wide_daily(
    power: dict[str, pd.DataFrame],
    forecast: dict[str, pd.DataFrame],
    cells: pd.Index,
    start: date,
    end: date,
) -> dict[str, pd.DataFrame]:
    """Combine POWER and forecast weather into the wide frames the model expects.

    POWER wins wherever it has a value. The forecast only fills days POWER
    doesn't have.

    Args:
        power: Per-cell POWER frames from fetch_power.
        forecast: Per-cell forecast frames from fetch_forecast.
        cells: Every cell id, so missing cells become all-NaN columns.
        start: First date.
        end: Last date, inclusive.
    Returns:
        {POWER parameter: DataFrame of dates x cell ids}, as model.features_for_week takes.
    Called by: score_week.
    """
    dates = pd.date_range(start, end, name="date")
    daily = {}
    for parameter in sources.POWER_PARAMETERS:
        observed = pd.DataFrame(
            {cell: power[cell][parameter] for cell in cells if cell in power}, index=dates
        ).reindex(columns=cells)
        if parameter in FORECAST_VARIABLES:
            predicted = pd.DataFrame(
                {cell: forecast[cell][parameter] for cell in cells if cell in forecast}, index=dates
            ).reindex(columns=cells)
            observed = observed.fillna(predicted)
        daily[parameter] = observed.astype("float32")
    return daily


def score_week(
    week_start: date | None = None,
    *,
    today: date | None = None,
    model: WildfireModel | None = None,
    cache_dir: Path = LIVE_DIR,
    workers: int = 3,
    per_minute: float = 60,
) -> WeeklyScores:
    """Fetch the weather and score every county for one week.

    Does no output I/O, so the same function runs locally, in a scheduled
    container, or behind the AWS handler.

    Args:
        week_start: The Monday to score. Defaults to the Monday on or before today.
        today: Today's date (UTC by default). Days after it come from the forecast.
        model: A loaded WildfireModel, to reuse one across calls. Loaded if None.
        cache_dir: Folder for POWER download caches.
        workers: Concurrent POWER requests.
        per_minute: Most POWER requests per minute.
    Returns:
        The WeeklyScores, with one probability per county that had weather for the week.
    Raises:
        ValueError: If week_start isn't a Monday, or no county could be scored.
    Called by: main, handler.lambda_handler.
    """
    today = today or datetime.now(UTC).date()
    week_start = week_start or current_week_start(today)
    if week_start.weekday() != 0:
        raise ValueError(f"week_start must be a Monday, got {week_start} ({week_start:%A})")
    start = week_start - timedelta(days=HISTORY_DAYS)
    end = week_start + timedelta(days=6)

    model = model or WildfireModel.load()
    cells = model.county_cells.drop_duplicates("cell").set_index("cell")[["cell_lat", "cell_lon"]]

    power = fetch_power(cells, start, min(end, today), workers, per_minute, cache_dir)
    forecast_start = max(min(end, today) - timedelta(days=14), today - timedelta(days=FORECAST_PAST_DAYS))
    forecast = fetch_forecast(cells, forecast_start, end) if forecast_start <= end else {}
    daily = wide_daily(power, forecast, cells.index, start, end)

    X = model.features_for_week(daily, pd.Timestamp(week_start))
    # Without this week's weather a county would be scored on history alone, which
    # isn't what the 20% is for. Leave it out, so the API falls back for it.
    scored = X[X["week_tmax_mean"].notna()]
    if scored.empty:
        raise ValueError("No county has weather for the week")
    dropped = len(X) - len(scored)
    if dropped:
        logger.warning("%d counties have no weather for the week and are left out", dropped)

    probability = model.predict(scored)
    logger.info(
        "Scored %d counties for the week of %s (median probability %.3f%%)",
        len(scored),
        week_start,
        100 * float(np.median(probability)),
    )
    return WeeklyScores(
        week_start=week_start,
        generated_at=datetime.now(UTC).isoformat(timespec="seconds"),
        model_trained_at=model.metadata.get("trained_at"),
        probabilities={
            str(fips): float(f"{p:.6g}")
            for fips, p in zip(scored.index, probability, strict=True)
            if np.isfinite(p)
        },
    )


def publish(scores: WeeklyScores, store: ScoresStore) -> None:
    """Write a week's scores where the API reads them.

    Args:
        scores: The result of score_week.
        store: Destination, from weekly_scores.open_store.
    Returns:
        None. The store replaces the previous week atomically.
    Called by: main, handler.lambda_handler.
    """
    store.write(scores.to_json())
    logger.info(
        "Published %d counties for the week of %s to %s",
        len(scores.probabilities),
        scores.week_start,
        store.describe(),
    )


def output_location(override: str | None = None) -> str:
    """Pick where to publish: an explicit value, else WILDFIRE_MODEL_URI, else the default.

    Args:
        override: --output, if given.
    Returns:
        A file path or s3:// URI.
    Called by: main, handler.lambda_handler.
    """
    return override or os.environ.get("WILDFIRE_MODEL_URI") or DEFAULT_OUTPUT


def main() -> None:
    """Score one week from the command line and publish it.

    Returns:
        None.
    Raises:
        SystemExit: If --week isn't a Monday, or no county could be scored.
    Called by: the command line (python -m ml.wildfire.predict_week).
    """
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--week", type=date.fromisoformat, help="The Monday to score (default: this week)")
    parser.add_argument("--output", help="File path or s3://bucket/key (default: WILDFIRE_MODEL_URI or data/wildfire_model.json)")
    parser.add_argument("--cache-dir", type=Path, default=Path(os.environ.get("WILDFIRE_CACHE_DIR", LIVE_DIR)))
    parser.add_argument("--workers", type=int, default=3)
    parser.add_argument("--per-minute", type=float, default=60, help="Most POWER requests per minute")
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    logging.getLogger("httpx").setLevel(logging.WARNING)

    try:
        scores = score_week(
            args.week, cache_dir=args.cache_dir, workers=args.workers, per_minute=args.per_minute
        )
    except ValueError as error:
        raise SystemExit(str(error)) from error
    publish(scores, open_store(output_location(args.output), base_dir=BACKEND_DIR))


if __name__ == "__main__":
    main()

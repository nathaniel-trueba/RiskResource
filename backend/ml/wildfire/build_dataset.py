"""Builds the county-week training table from MTBS, NASA POWER and Open-Meteo.

Run from backend/:  python -m ml.wildfire.build_dataset

Downloads are cached under ml/wildfire/data/raw/, so a re-run only fetches what's
missing. The first run downloads about 2,000 NASA POWER grid cells (20 to 40
minutes). Writes:
- data/county_weeks.parquet: one row per county and week, FEATURES plus the label.
- data/climatology.parquet, data/history_latest.parquet, data/county_static.parquet,
  data/county_cells.parquet: lookup tables that inference needs, copied into
  artifacts/ by train.py.
"""

import argparse
import logging
import time

import numpy as np
import pandas as pd

from ml.wildfire import features as F
from ml.wildfire import sources
from ml.wildfire.config import (
    CLIMATOLOGY_YEARS,
    DATA_DIR,
    DATASET_PATH,
    FIRST_YEAR,
    HISTORY_START_YEAR,
    LAST_YEAR,
)

logger = logging.getLogger(__name__)


def week_starts() -> pd.DatetimeIndex:
    """List the Monday of every week in the dataset.

    Returns:
        DatetimeIndex of every Monday whose ISO week belongs to FIRST_YEAR through
        LAST_YEAR (for example, ISO 2010 starts on Monday 2010-01-04).
    Called by: build.
    """
    mondays = pd.date_range(f"{FIRST_YEAR - 1}-12-25", f"{LAST_YEAR}-12-31", freq="W-MON")
    iso_year = mondays.isocalendar().year
    return mondays[(iso_year >= FIRST_YEAR) & (iso_year <= LAST_YEAR)]


def load_weather(cells: pd.DataFrame) -> dict[str, pd.DataFrame]:
    """Read every cached POWER cell into one wide DataFrame per parameter.

    Args:
        cells: DataFrame indexed by cell id, with cell_lat and cell_lon. Every cell
            must already be downloaded.
    Returns:
        Dict mapping each POWER_PARAMETERS name to a DataFrame of dates x cell ids,
        the input format of features.weekly_weather_features.
    Raises:
        FileNotFoundError: If a cell isn't cached.
    Called by: build.
    """
    frames = {}
    for row in cells.itertuples():
        frames[row.Index] = sources.read_power_cell(row.cell_lat, row.cell_lon)
    return {
        name: pd.DataFrame({cell: frame[name] for cell, frame in frames.items()})
        for name in sources.POWER_PARAMETERS
    }


def build(workers: int, per_minute: float) -> pd.DataFrame:
    """Download every source and assemble the county-week training table.

    Steps: load counties and elevations; download MTBS fires and place each in a
    county; download weather for every county's POWER cell; compute weekly weather
    features, climatology and anomalies per cell; expand to one row per county and
    week; join fire history, static and season features; label each row with
    whether an MTBS wildfire ignited in that county that week.

    Args:
        workers: Concurrent NASA POWER requests.
        per_minute: Most NASA POWER requests per minute.
    Returns:
        The table that was written to DATASET_PATH: fips, week_start, year (ISO),
        fire (0/1 label) and every column in features.FEATURES. Also writes the
        inference lookup tables (climatology, history_latest, county_static,
        county_cells) to DATA_DIR.
    Raises:
        RuntimeError: If some POWER cells failed to download (re-run to resume).
    Called by: main.
    """
    started = time.time()
    counties, geometries = sources.load_counties()
    elevation = sources.load_elevations(counties)

    fires = sources.load_mtbs_fires()
    fires["fips"] = sources.assign_counties(
        fires["latitude"].to_numpy(), fires["longitude"].to_numpy(), counties.index, geometries
    )
    logger.info(
        "MTBS: %d fires since %d, %d outside every county",
        len(fires), HISTORY_START_YEAR, fires["fips"].isna().sum(),
    )

    # Weather, per NASA POWER grid cell
    cell_lat, cell_lon = sources.power_cell(counties["lat"], counties["lon"])
    counties["cell"] = [sources.cell_id(a, b) for a, b in zip(cell_lat, cell_lon)]
    cells = (
        pd.DataFrame({"cell": counties["cell"], "cell_lat": cell_lat, "cell_lon": cell_lon})
        .drop_duplicates("cell")
        .set_index("cell")
    )
    sources.download_power_cells(cells, workers=workers, per_minute=per_minute)
    logger.info("Computing weekly weather features for %d cells", len(cells))
    weeks = week_starts()
    weather = F.weekly_weather_features(load_weather(cells), weeks)
    climatology = F.build_climatology(weather, CLIMATOLOGY_YEARS)
    F.add_anomalies(weather, climatology)
    weather = weather.rename(columns={"location": "cell"})

    # One row per county and week
    rows = pd.DataFrame(
        {
            "fips": np.repeat(counties.index.to_numpy(), len(weeks)),
            "week_start": np.tile(weeks.to_numpy(), len(counties)),
        }
    )
    rows["cell"] = rows["fips"].map(counties["cell"])
    rows["year"] = F.week_year(rows["week_start"]).to_numpy()
    rows["month"] = F.week_month(rows["week_start"]).to_numpy()
    rows = rows.merge(weather, on=["cell", "week_start"], how="left")

    history = F.fire_history(counties, fires, range(FIRST_YEAR, LAST_YEAR + 1), HISTORY_START_YEAR)
    rows = rows.join(history, on=["fips", "year", "month"])
    static = F.static_features(counties, elevation)
    rows = rows.join(static, on="fips")
    rows[F.SEASON_FEATURES] = F.season_features(rows["week_start"])

    # Label: a large wildfire's ignition point is in the county during the week.
    labelled = fires.dropna(subset=["fips"])
    fire_weeks = labelled["ig_date"] - pd.to_timedelta(labelled["ig_date"].dt.day_of_week, unit="D")
    positives = pd.MultiIndex.from_arrays([labelled["fips"], fire_weeks]).unique()
    keys = pd.MultiIndex.from_arrays([rows["fips"], rows["week_start"]])
    rows["fire"] = keys.isin(positives).astype("int8")

    rows = rows[["fips", "week_start", "year", "fire", *F.FEATURES]]
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    rows.to_parquet(DATASET_PATH, index=False)

    # Lookup tables for inference.
    climatology.to_parquet(DATA_DIR / "climatology.parquet")
    F.fire_history(counties, fires, [LAST_YEAR + 1], HISTORY_START_YEAR).droplevel("year").to_parquet(
        DATA_DIR / "history_latest.parquet"
    )
    static.to_parquet(DATA_DIR / "county_static.parquet")
    counties[["state", "cell"]].join(cells, on="cell").to_parquet(DATA_DIR / "county_cells.parquet")

    by_year = rows.groupby("year")["fire"].agg(["sum", "mean"])
    logger.info("Positive county-weeks per year:\n%s", by_year.to_string())
    logger.info(
        "Wrote %d rows (%d positives) to %s in %.0fs",
        len(rows), rows["fire"].sum(), DATASET_PATH, time.time() - started,
    )
    return rows


def main() -> None:
    """Command-line entry point: parse --workers and --per-minute, set up logging, build.

    Called by: `python -m ml.wildfire.build_dataset`.
    """
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--workers", type=int, default=3, help="Concurrent NASA POWER requests")
    parser.add_argument(
        "--per-minute", type=float, default=60, help="Most NASA POWER requests per minute"
    )
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    logging.getLogger("httpx").setLevel(logging.WARNING)
    build(args.workers, args.per_minute)


if __name__ == "__main__":
    main()

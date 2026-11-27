"""Downloads the model's upstream data, caching each source under data/raw/.

Sources:
- Counties: data/reference.json (the same data seeded into Supabase) for centroids
  and population, plus the Plotly county GeoJSON for boundaries and area.
- Fires (labels and history): MTBS fire occurrence points from the USFS EDW ArcGIS
  service. MTBS maps every large fire (about 1,000+ acres in the West, 500+ in the
  East) from satellite imagery with one method since 1984, so yearly counts are
  consistent. Incident-report sources (NIFC WFIGS, InFORM) are not: their counts
  roughly quadruple from 2020 as state and local agencies started reporting, which
  would make 2021+ look far more fire-prone than 2010-2020 for reporting reasons.
- Weather: NASA POWER daily point API (MERRA-2 reanalysis, 0.5 x 0.625 degree grid).
  No key or daily quota, unlike Open-Meteo's archive, which can't serve 15 years
  for 3,000+ locations on its free tier.
- Elevation: Open-Meteo elevation API.
"""

import json
import logging
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

import httpx
import numpy as np
import pandas as pd
import shapely
from shapely.geometry import shape

from ml.wildfire.config import (
    HISTORY_START_YEAR,
    LAST_YEAR,
    POWER_DIR,
    RAW_DIR,
    REFERENCE_PATH,
    USER_AGENT,
    WEATHER_END,
    WEATHER_START,
)

logger = logging.getLogger(__name__)

COUNTIES_GEOJSON_URL = (
    "https://raw.githubusercontent.com/plotly/datasets/master/geojson-counties-fips.json"
)
MTBS_URL = "https://apps.fs.usda.gov/arcx/rest/services/EDW/EDW_MTBS_01/MapServer/62/query"
# Prescribed fires and "Other" are excluded: we want unplanned ignitions.
# Wildland Fire Use fires are natural ignitions managed for resource benefit.
MTBS_FIRE_TYPES = ("Wildfire", "Wildland Fire Use")
POWER_URL = "https://power.larc.nasa.gov/api/temporal/daily/point"
# T2M_MAX: daily max temperature (C). T2MDEW: dew point (C). RH2M: mean relative
# humidity (%). WS10M_MAX: max 10 m wind (m/s). PRECTOTCORR: precipitation (mm/day).
# GWETTOP / GWETROOT: surface and root-zone soil wetness (0 to 1).
POWER_PARAMETERS = ("T2M_MAX", "T2MDEW", "RH2M", "WS10M_MAX", "PRECTOTCORR", "GWETTOP", "GWETROOT")
POWER_FILL_VALUE = -999.0
# MERRA-2 grid spacing. Counties in the same cell share one download.
POWER_LAT_STEP, POWER_LON_STEP = 0.5, 0.625
ELEVATION_URL = "https://api.open-meteo.com/v1/elevation"


def _client() -> httpx.Client:
    """Create the HTTP client used for every upstream request.

    Returns:
        An httpx.Client that sends our User-Agent, follows redirects and allows up to
        180 seconds per request (a 15-year POWER response can be slow). Use it as a
        context manager so it's closed.
    Called by: load_counties, load_mtbs_fires, download_power_cells, load_elevations.
    """
    return httpx.Client(headers={"User-Agent": USER_AGENT}, timeout=180, follow_redirects=True)


class _Pacer:
    """Spaces out request starts across threads to at most one per `interval` seconds.

    Used by: download_power_cells (one pacer shared by all its workers), passed through
    fetch_power_cell to _get_json.
    """

    def __init__(self, interval: float):
        """Create a pacer.

        Args:
            interval: Minimum seconds between two request starts, across all threads.
        Called by: download_power_cells.
        """
        self.interval = interval
        self._lock = threading.Lock()
        self._next = 0.0

    def wait(self) -> None:
        """Block until this thread may start its next request.

        Each caller reserves the next free slot under a lock, then sleeps outside it,
        so threads queue up one interval apart.

        Returns:
            None, once the reserved slot has arrived.
        Called by: _get_json, before every attempt (including retries).
        """
        with self._lock:
            now = time.monotonic()
            start = max(now, self._next)
            self._next = start + self.interval
        time.sleep(max(0.0, start - now))


def _get_json(
    client: httpx.Client,
    url: str,
    params: dict,
    attempts: int = 5,
    backoff: float = 5,
    pacer: "_Pacer | None" = None,
) -> dict:
    """GET a JSON response, retrying with exponential backoff on errors and rate limits.

    Any HTTP error status (including 429), network error or unparseable body is
    retried, waiting backoff, 2 x backoff, 4 x backoff, ... seconds between attempts.

    Args:
        client: Open client from _client().
        url: Endpoint URL.
        params: Query string parameters.
        attempts: Total tries before giving up.
        backoff: Seconds to wait after the first failure. Doubles after each one.
        pacer: Optional shared rate limiter, waited on before every attempt.
    Returns:
        The decoded JSON body.
    Raises:
        httpx.HTTPError or ValueError: From the last attempt, if every attempt failed.
    Called by: load_mtbs_fires, fetch_power_cell, load_elevations.
    """
    for attempt in range(attempts):
        if pacer is not None:
            pacer.wait()
        try:
            response = client.get(url, params=params)
            if response.status_code == 429 or response.status_code >= 500:
                raise httpx.HTTPStatusError(
                    f"HTTP {response.status_code}", request=response.request, response=response
                )
            response.raise_for_status()
            return response.json()
        except (httpx.HTTPError, ValueError) as error:
            if attempt == attempts - 1:
                raise
            wait = backoff * 2**attempt
            logger.warning("%s failed (%s), retrying in %ds", url, error, wait)
            time.sleep(wait)
    raise AssertionError("unreachable")


# Counties ---------------------------------------------------------------------


def load_counties() -> tuple[pd.DataFrame, list]:
    """Load every county with its centroid, population, area and boundary.

    Centroids and populations come from backend/data/reference.json, the snapshot
    seeded into Supabase, so the model uses exactly the backend's county list.
    Boundaries come from the Plotly county GeoJSON, downloaded once and cached at
    data/raw/counties.geojson. Counties with no boundary are skipped.

    Returns:
        (counties, geometries): a DataFrame indexed by fips (5-character string) with
        state, lat, lon, population and area_km2, and a list of shapely geometries
        in the same row order.
    Raises:
        httpx.HTTPStatusError: If the GeoJSON download fails.
    Called by: build_dataset.build.
    """
    reference = json.loads(REFERENCE_PATH.read_text(encoding="utf-8"))["counties"]
    path = RAW_DIR / "counties.geojson"
    if not path.exists():
        logger.info("Downloading county boundaries")
        RAW_DIR.mkdir(parents=True, exist_ok=True)
        with _client() as client:
            response = client.get(COUNTIES_GEOJSON_URL)
            response.raise_for_status()
            path.write_bytes(response.content)
    features = {f["id"]: f["geometry"] for f in json.loads(path.read_text(encoding="utf-8"))["features"]}

    rows, geometries = [], []
    for fips, county in reference.items():
        geometry = features.get(fips)
        if geometry is None:
            continue
        geom = shapely.make_valid(shape(geometry))
        rows.append(
            {
                "fips": fips,
                "state": county["state"],
                "lat": county["lat"],
                "lon": county["lon"],
                "population": county["population"] or 0,
                "area_km2": _area_km2(geom),
            }
        )
        geometries.append(geom)
    counties = pd.DataFrame(rows).set_index("fips")
    logger.info("Loaded %d counties", len(counties))
    return counties, geometries


def _area_km2(geom) -> float:
    """Approximate the area of a lon/lat geometry in km2.

    Each polygon's area in square degrees is converted with 111.32 km per degree and
    scaled by cos(latitude) at its centroid. Accurate to a few percent for
    county-sized shapes, which is plenty for a size feature.

    Args:
        geom: Shapely Polygon or MultiPolygon (or GeometryCollection from make_valid)
            in lon/lat degrees. Non-polygon parts are ignored.
    Returns:
        Area in km2.
    Called by: load_counties.
    """
    polygons = getattr(geom, "geoms", [geom])
    total = 0.0
    for polygon in polygons:
        if polygon.geom_type != "Polygon":
            continue
        lat = polygon.centroid.y
        total += polygon.area * 111.32**2 * np.cos(np.radians(lat))
    return total


def assign_counties(lat: np.ndarray, lon: np.ndarray, fips: pd.Index, geometries: list) -> np.ndarray:
    """Find the county containing each point, falling back to the nearest one nearby.

    Points inside no polygon (on a coastline, or just over a border the simplified
    boundaries miss) go to the nearest county within 0.1 degrees (about 10 km).

    Args:
        lat: Point latitudes.
        lon: Point longitudes, same length as lat.
        fips: County FIPS codes, in the same order as geometries.
        geometries: County shapes from load_counties.
    Returns:
        Object array of FIPS strings, one per point, with None for points farther
        than 0.1 degrees from every county (offshore or outside the US).
    Called by: build_dataset.build, to place each MTBS ignition point in a county.
    """
    tree = shapely.STRtree(geometries)
    points = shapely.points(lon, lat)
    result = np.full(len(points), None, dtype=object)
    point_idx, geom_idx = tree.query(points, predicate="intersects")
    result[point_idx] = fips.to_numpy()[geom_idx]
    missing = np.flatnonzero(pd.isna(result))
    if len(missing):
        near_point, near_geom = tree.query_nearest(points[missing], max_distance=0.1)
        result[missing[near_point]] = fips.to_numpy()[near_geom]
    return result


# Fires ----------------------------------------------------------------------


def load_mtbs_fires() -> pd.DataFrame:
    """Download every MTBS wildfire ignition point from HISTORY_START_YEAR on.

    Pages through the MTBS "Fire Occurrence Locations (All Years)" layer 2,000
    records at a time, keeping only MTBS_FIRE_TYPES. Fires through the end of
    LAST_YEAR + 1 are fetched, so a partial newer year is included if MTBS has
    published it, but build_dataset only labels rows through LAST_YEAR. The result
    is cached at data/raw/mtbs_fires.parquet; delete that file to re-download.

    Returns:
        DataFrame with one row per fire: fire_id, fire_name, fire_type, ig_date
        (ignition date as a midnight timestamp), latitude, longitude and acres.
    Raises:
        RuntimeError: If the ArcGIS service returns an error payload.
        httpx.HTTPError: If a page still fails after retries.
    Called by: build_dataset.build, notebooks/01_data.ipynb.
    """
    path = RAW_DIR / "mtbs_fires.parquet"
    if path.exists():
        return pd.read_parquet(path)
    logger.info("Downloading MTBS fire occurrence points")
    types = ", ".join(f"'{t}'" for t in MTBS_FIRE_TYPES)
    where = (
        f"fire_type IN ({types}) AND ig_date >= DATE '{HISTORY_START_YEAR}-01-01'"
        f" AND ig_date < DATE '{LAST_YEAR + 2}-01-01'"
    )
    rows, offset = [], 0
    with _client() as client:
        while True:
            data = _get_json(
                client,
                MTBS_URL,
                {
                    "where": where,
                    "outFields": "fire_id,fire_name,fire_type,ig_date,latitude,longitude,acres",
                    "returnGeometry": "false",
                    "orderByFields": "objectid",
                    "resultOffset": offset,
                    "resultRecordCount": 2000,
                    "f": "json",
                },
            )
            if "error" in data:
                raise RuntimeError(f"MTBS query failed: {data['error']}")
            batch = [f["attributes"] for f in data.get("features", [])]
            rows.extend(batch)
            if not batch or not data.get("exceededTransferLimit"):
                break
            offset += len(batch)
    fires = pd.DataFrame(rows).drop_duplicates("fire_id")
    fires["ig_date"] = pd.to_datetime(fires["ig_date"], unit="ms").dt.normalize()
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    fires.to_parquet(path, index=False)
    logger.info("Downloaded %d MTBS fires", len(fires))
    return fires


# Weather --------------------------------------------------------------------


def power_cell(lat: np.ndarray, lon: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Snap coordinates to the center of their NASA POWER (MERRA-2) grid cell.

    The grid is 0.5 degrees of latitude by 0.625 degrees of longitude, so nearby
    counties share a cell and a single download.

    Args:
        lat: Latitudes (array-like).
        lon: Longitudes (array-like), same length.
    Returns:
        (cell_lat, cell_lon) arrays of cell-center coordinates.
    Called by: build_dataset.build. Its cells are reused by predict_week.py.
    """
    return (
        np.round(np.asarray(lat) / POWER_LAT_STEP) * POWER_LAT_STEP,
        np.round(np.asarray(lon) / POWER_LON_STEP) * POWER_LON_STEP,
    )


def cell_id(lat: float, lon: float) -> str:
    """Name a POWER grid cell, e.g. "33.500_-116.875".

    Used as the cache file name and as the location key in the weather features,
    the climatology and artifacts/county_cells.parquet.

    Args:
        lat: Cell-center latitude from power_cell.
        lon: Cell-center longitude from power_cell.
    Returns:
        The cell id string.
    Called by: build_dataset.build, download_power_cells, read_power_cell.
    """
    return f"{lat:.3f}_{lon:.3f}"


def fetch_power_cell(
    client: httpx.Client,
    lat: float,
    lon: float,
    start=WEATHER_START,
    end=WEATHER_END,
    pacer: _Pacer | None = None,
    attempts: int = 6,
    backoff: float = 60,
) -> pd.DataFrame:
    """Download daily NASA POWER weather for one point.

    Retries rate limits patiently (6 attempts, waiting 60 s and doubling), because
    POWER's CloudFront limit blocks for minutes at a time.

    Args:
        client: Open client from _client(). Safe to share across threads.
        lat: Latitude of the point (normally a cell center from power_cell).
        lon: Longitude of the point.
        start: First date (datetime.date). Defaults to WEATHER_START.
        end: Last date, inclusive. Defaults to WEATHER_END.
        pacer: Optional shared rate limiter.
        attempts: Total tries. The default suits a long local run; the AWS step
            uses 1, so a rate limit fails fast and Step Functions retries later.
        backoff: Seconds to wait after the first failure. Doubles after each one.
    Returns:
        DataFrame indexed by date ("date"), one float32 column per POWER_PARAMETERS
        entry, with POWER's -999 fill values replaced by NaN.
    Raises:
        httpx.HTTPError: If every attempt fails.
    Called by: download_power_cells, predict_week.fetch_power (recent days before a
    live week), and aws/wildfire_steps.fetch_chunk.
    """
    data = _get_json(
        client,
        POWER_URL,
        {
            "parameters": ",".join(POWER_PARAMETERS),
            "community": "AG",
            "latitude": f"{lat:.4f}",
            "longitude": f"{lon:.4f}",
            "start": start.strftime("%Y%m%d"),
            "end": end.strftime("%Y%m%d"),
            "format": "JSON",
        },
        # POWER sits behind a CloudFront rate limit that answers 429 with no
        # Retry-After once you go much above ~100 requests a minute.
        attempts=attempts,
        backoff=backoff,
        pacer=pacer,
    )
    parameters = data["properties"]["parameter"]
    frame = pd.DataFrame({name: parameters[name] for name in POWER_PARAMETERS})
    frame.index = pd.to_datetime(frame.index, format="%Y%m%d")
    frame.index.name = "date"
    return frame.astype("float32").replace(POWER_FILL_VALUE, np.nan)


def download_power_cells(
    cells: pd.DataFrame, workers: int = 3, per_minute: float = 60
) -> None:
    """Download every grid cell not yet cached under data/raw/power/.

    Cells that already have a parquet file are skipped, so an interrupted run
    resumes where it left off. Each cell is written to a .tmp file and renamed when
    complete, so a killed run never leaves a half-written cache file. A failed cell
    doesn't stop the others; failures are reported together at the end.

    Args:
        cells: DataFrame with cell_lat and cell_lon columns, one row per cell.
        workers: Concurrent requests.
        per_minute: Most request starts per minute, across all workers.
    Returns:
        None. Results are the files data/raw/power/<cell_id>.parquet.
    Raises:
        RuntimeError: If any cell failed after retries. Re-run to fetch only those.
    Called by: build_dataset.build.
    """
    pacer = _Pacer(60 / per_minute)
    POWER_DIR.mkdir(parents=True, exist_ok=True)
    todo = [
        (row.cell_lat, row.cell_lon)
        for row in cells.itertuples()
        if not (POWER_DIR / f"{cell_id(row.cell_lat, row.cell_lon)}.parquet").exists()
    ]
    logger.info("NASA POWER: %d of %d cells to download", len(todo), len(cells))
    if not todo:
        return

    def work(lat: float, lon: float) -> None:
        """Download one cell and save it atomically. Runs on a worker thread."""
        frame = fetch_power_cell(client, lat, lon, pacer=pacer)
        tmp = POWER_DIR / f"{cell_id(lat, lon)}.tmp"
        frame.to_parquet(tmp)
        tmp.replace(POWER_DIR / f"{cell_id(lat, lon)}.parquet")

    with _client() as client, ThreadPoolExecutor(workers) as pool:
        futures = {pool.submit(work, lat, lon): (lat, lon) for lat, lon in todo}
        failed = []
        for done, future in enumerate(as_completed(futures), 1):
            try:
                future.result()
            except Exception as error:  # noqa: BLE001 - keep going, report at the end
                failed.append(futures[future])
                logger.error("Cell %s failed: %s", futures[future], error)
            if done % 100 == 0:
                logger.info("NASA POWER: %d / %d cells", done, len(todo))
    if failed:
        raise RuntimeError(f"{len(failed)} NASA POWER cells failed; re-run to retry them")


def read_power_cell(lat: float, lon: float) -> pd.DataFrame:
    """Read one cached POWER cell.

    Args:
        lat: Cell-center latitude.
        lon: Cell-center longitude.
    Returns:
        The DataFrame fetch_power_cell saved: indexed by date, one column per
        POWER_PARAMETERS entry.
    Raises:
        FileNotFoundError: If the cell hasn't been downloaded.
    Called by: build_dataset.load_weather, notebooks/03_predict.ipynb.
    """
    return pd.read_parquet(POWER_DIR / f"{cell_id(lat, lon)}.parquet")


# Elevation ------------------------------------------------------------------


def load_elevations(counties: pd.DataFrame) -> pd.Series:
    """Look up the elevation at each county centroid, from Open-Meteo.

    Sends 100 coordinates per request, 10 seconds apart, because Open-Meteo counts
    each coordinate toward its 600-per-minute limit. Cached at
    data/raw/elevation.parquet, and re-downloaded only if the county list changes.

    Args:
        counties: DataFrame from load_counties (indexed by fips, with lat and lon).
    Returns:
        float32 Series of elevations in meters, indexed like counties, named
        "elevation_m".
    Raises:
        httpx.HTTPError: If a request still fails after retries.
    Called by: build_dataset.build.
    """
    path = RAW_DIR / "elevation.parquet"
    if path.exists():
        cached = pd.read_parquet(path)["elevation_m"]
        if cached.index.equals(counties.index):
            return cached
    logger.info("Downloading county elevations")
    values = []
    with _client() as client:
        for start in range(0, len(counties), 100):
            chunk = counties.iloc[start : start + 100]
            data = _get_json(
                client,
                ELEVATION_URL,
                {
                    "latitude": ",".join(f"{v:.4f}" for v in chunk["lat"]),
                    "longitude": ",".join(f"{v:.4f}" for v in chunk["lon"]),
                },
            )
            values.extend(data["elevation"])
            # Open-Meteo counts each coordinate as a call (600 per minute).
            time.sleep(10)
    elevation = pd.Series(values, index=counties.index, name="elevation_m", dtype="float32")
    elevation.to_frame().to_parquet(path)
    return elevation

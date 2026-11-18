"""Postgres (Supabase) connection and one-time initialization.

initialize() runs at every startup but only does work the first time: it creates
the tables in db/schema.sql if any are missing, and seeds the reference data
from data/reference.json if it's empty. Afterwards each startup costs two quick
queries. To replace the data later, use scripts/init_db.py.
"""

import json
import logging
import re
from pathlib import Path

import psycopg

from app.config import BACKEND_DIR, Settings
from app.domain.hazards import Hazard

logger = logging.getLogger(__name__)

SCHEMA_PATH = BACKEND_DIR / "db" / "schema.sql"

# Children first, so one TRUNCATE covers every foreign key between them.
REFERENCE_TABLES = (
    "nri_county_losses",
    "nri_state_losses",
    "nri_county_profiles",
    "nri_state_profiles",
    "nri_meta",
    "county_hazard_baselines",
    "state_hazard_declarations",
    "counties",
    "states",
    "hazards",
    "reference_meta",
)

# Held during initialization so two processes starting at once don't both seed.
_INIT_LOCK_ID = 727_401_001


class DatabaseNotConfiguredError(RuntimeError):
    pass


def connect(settings: Settings) -> psycopg.Connection:
    """Open a Postgres connection using DATABASE_URL.

    Args:
        settings: App settings holding database_url.
    Returns:
        An open psycopg connection. Use it as a context manager to commit and close.
    Raises:
        DatabaseNotConfiguredError: If DATABASE_URL is missing or has the placeholder password.
        psycopg.OperationalError: If the database can't be reached.
    Called by: main.lifespan (load_reference), scripts/init_db.main.
    """
    url = settings.database_url
    if not url:
        raise DatabaseNotConfiguredError(
            "DATABASE_URL is not set. Add the Supabase session pooler connection string "
            "to backend/.env (see env.example)."
        )
    if "[YOUR-PASSWORD]" in url:
        raise DatabaseNotConfiguredError(
            "DATABASE_URL still contains the [YOUR-PASSWORD] placeholder. Replace it with "
            "the database password from Supabase (URL-encode any special characters)."
        )
    # prepare_threshold=None turns off server-side prepared statements, which
    # Supabase's transaction pooler (port 6543) doesn't support. Harmless otherwise.
    return psycopg.connect(url, connect_timeout=10, prepare_threshold=None)


def initialize(
    conn: psycopg.Connection, snapshot_path: Path, *, reseed_with: dict | None = None
) -> None:
    """Create missing tables, then seed the reference data if it's empty.

    Everything happens in one transaction, under an advisory lock, so readers never
    see half-seeded tables and two processes starting at once don't both seed.

    Args:
        conn: Open connection, not in autocommit mode.
        snapshot_path: The reference.json snapshot to seed from when the data is empty.
        reseed_with: Data in the reference.json format. When given, it replaces the
            reference data even if the tables are already seeded.
    Returns:
        None. Commits on success.
    Raises:
        FileNotFoundError: If the data is empty and snapshot_path doesn't exist.
    Called by: main.lifespan (load_reference) at every startup, scripts/init_db.main.
    """
    with conn.transaction():
        conn.execute("SELECT pg_advisory_xact_lock(%s)", (_INIT_LOCK_ID,))

        missing = missing_tables(conn)
        if missing:
            logger.info("Creating missing tables: %s", ", ".join(missing))
            conn.execute(SCHEMA_PATH.read_text(encoding="utf-8"))

        if reseed_with is not None:
            seed_reference(conn, reseed_with)
        elif not is_seeded(conn):
            if not snapshot_path.exists():
                raise FileNotFoundError(
                    f"The reference data is empty and there's no snapshot at {snapshot_path} "
                    "to seed it from. Build one with: python -m scripts.init_db --refresh"
                )
            logger.info("Seeding reference data from %s", snapshot_path)
            seed_reference(conn, load_snapshot(snapshot_path))


def schema_tables() -> list[str]:
    """List the tables db/schema.sql defines.

    Returns:
        Table names, in file order, parsed from its CREATE TABLE statements.
    Called by: missing_tables.
    """
    sql = SCHEMA_PATH.read_text(encoding="utf-8")
    return re.findall(r"CREATE TABLE IF NOT EXISTS public\.(\w+)", sql, flags=re.IGNORECASE)


def missing_tables(conn: psycopg.Connection) -> list[str]:
    """Return the schema's tables that don't exist in the database yet.

    Args:
        conn: Open connection.
    Returns:
        Names of missing tables, empty when the schema is fully applied.
    Called by: initialize.
    """
    rows = conn.execute(
        "SELECT name FROM unnest(%s::text[]) AS name WHERE to_regclass('public.' || name) IS NULL",
        (schema_tables(),),
    ).fetchall()
    return [name for (name,) in rows]


def is_seeded(conn: psycopg.Connection) -> bool:
    """Return whether every reference table has data.

    Checking every table means a database seeded before a table was added gets
    reseeded, so new reference data appears without a manual step.

    Args:
        conn: Open connection. The reference tables must exist.
    Returns:
        True if none of REFERENCE_TABLES is empty.
    Called by: initialize.
    """
    checks = " AND ".join(f"EXISTS (SELECT 1 FROM public.{t})" for t in REFERENCE_TABLES)
    return conn.execute(f"SELECT {checks}").fetchone()[0]


def load_snapshot(path: Path) -> dict:
    """Read a reference.json snapshot.

    Args:
        path: Path to the JSON file.
    Returns:
        Its contents: {"meta": ..., "states": ..., "counties": ..., "nri": ...}.
    Called by: initialize, scripts/init_db.main (--reseed).
    """
    return json.loads(path.read_text(encoding="utf-8"))


def seed_reference(conn: psycopg.Connection, data: dict) -> None:
    """Replace the reference tables' contents with the given data.

    Truncates all reference tables, then bulk loads them with COPY. Doesn't commit:
    the caller's transaction does.

    Args:
        conn: Open connection, inside a transaction.
        data: Data in the reference.json format.
    Returns:
        None.
    Raises:
        ValueError: If the data has no "nri" section (a snapshot from before NRI).
    Called by: initialize.
    """
    states, counties, meta = data["states"], data["counties"], data["meta"]
    nri = data.get("nri")
    if nri is None:
        raise ValueError(
            "This reference snapshot has no NRI loss data. Rebuild it with: "
            "python -m scripts.init_db --refresh"
        )
    conn.execute(f"TRUNCATE {', '.join(f'public.{t}' for t in REFERENCE_TABLES)}")
    with conn.cursor() as cur:
        _copy(cur, "hazards (code, label)", ((h.value, h.label) for h in Hazard))
        _copy(cur, "states (code, name)", ((code, s["name"]) for code, s in states.items()))
        _copy(
            cur,
            "counties (fips, state_code, name, bare_name, latitude, longitude,"
            " bbox_west, bbox_south, bbox_east, bbox_north, population)",
            (
                (fips, c["state"], c["name"], c["bareName"], c["lat"], c["lon"],
                 *c["bbox"], c["population"])
                for fips, c in counties.items()
            ),
        )
        _copy(
            cur,
            "county_hazard_baselines (county_fips, hazard, event_count, baseline_score)",
            (
                (fips, h.value, c["counts"][h.value], c["baseline"][h.value])
                for fips, c in counties.items()
                for h in Hazard
            ),
        )
        _copy(
            cur,
            "state_hazard_declarations (state_code, hazard, declaration_count)",
            (
                (code, hazard, count)
                for code, s in states.items()
                for hazard, count in s["declarations"].items()
            ),
        )
        cur.execute(
            "INSERT INTO public.reference_meta (generated_at, baseline_since_year,"
            " quake_min_magnitude, quake_radius_miles) VALUES (%s, %s, %s, %s)",
            (meta["generatedAt"], meta["baselineSinceYear"],
             meta["quakeMinMagnitude"], meta["quakeRadiusMiles"]),
        )
        _seed_nri(cur, nri)
    logger.info("Seeded %d states and %d counties", len(states), len(counties))


def _seed_nri(cur: psycopg.Cursor, nri: dict) -> None:
    """Load the NRI expected loss tables.

    Args:
        cur: Cursor on the seeding connection, after the base tables are loaded.
        nri: The snapshot's "nri" section, from build_reference_data.load_nri.
    Returns:
        None.
    Called by: seed_reference.
    """
    meta = nri["meta"]
    cur.execute(
        "INSERT INTO public.nri_meta (version, high_loss_percentile, high_loss_per_person)"
        " VALUES (%s, %s, %s)",
        (meta["version"], meta["highLossPercentile"], meta["highLossPerPersonThreshold"]),
    )
    counties, states = nri["counties"], nri["states"]
    _copy(
        cur,
        "nri_county_profiles (county_fips, population, social_vulnerability,"
        " community_resilience, loss_per_person_percentile)",
        (
            (fips, c["population"], c["socialVulnerability"], c["communityResilience"],
             c["lossPerPersonPercentile"])
            for fips, c in counties.items()
        ),
    )
    _copy(
        cur,
        "nri_county_losses (county_fips, hazard, expected_annual_loss)",
        ((fips, h, amount) for fips, c in counties.items() for h, amount in c["losses"].items()),
    )
    _copy(
        cur,
        "nri_state_profiles (state_code, population, high_loss_population)",
        ((code, s["population"], s["highLossPopulation"]) for code, s in states.items()),
    )
    _copy(
        cur,
        "nri_state_losses (state_code, hazard, expected_annual_loss)",
        ((code, h, amount) for code, s in states.items() for h, amount in s["losses"].items()),
    )


def _copy(cur: psycopg.Cursor, target: str, rows) -> None:
    """Bulk load rows into one table with COPY.

    Args:
        cur: Cursor on the seeding connection.
        target: Table and column list, e.g. "states (code, name)".
        rows: Iterable of tuples matching the column list.
    Returns:
        None.
    Called by: seed_reference.
    """
    with cur.copy(f"COPY public.{target} FROM STDIN") as copy:
        for row in rows:
            copy.write_row(row)

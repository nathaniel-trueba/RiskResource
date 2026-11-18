"""Initializes the database, or replaces its reference data. Run from backend/:

    python -m scripts.init_db            # Create missing tables, seed if empty (same as startup)
    python -m scripts.init_db --reseed   # Replace the reference data from data/reference.json
    python -m scripts.init_db --refresh  # Rebuild from FEMA, USGS and Census (~1 min), save
                                         # the result to data/reference.json, then reseed

The API runs the first form automatically at startup, so you only need this script
to replace data that's already seeded.
"""

import argparse
import json
import logging

from app.config import get_settings
from app.db import connect, initialize, load_snapshot


def main() -> None:
    """Parse the command line and initialize, reseed or refresh the database.

    Returns:
        None. Prints progress and exits non-zero on failure.
    Called by: `python -m scripts.init_db`.
    """
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--reseed", action="store_true", help="Replace the data from the snapshot")
    mode.add_argument("--refresh", action="store_true", help="Rebuild the snapshot, then reseed")
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    logging.getLogger("httpx").setLevel(logging.WARNING)  # Don't log every request

    settings = get_settings()
    snapshot = settings.reference_data_path
    data = None
    if args.refresh:
        from scripts.build_reference_data import build

        data = build()
        snapshot.parent.mkdir(parents=True, exist_ok=True)
        snapshot.write_text(json.dumps(data, separators=(",", ":")), encoding="utf-8")
        print(f"Saved the snapshot to {snapshot}")
    elif args.reseed:
        data = load_snapshot(snapshot)

    with connect(settings) as conn:
        initialize(conn, snapshot, reseed_with=data)
    print("Database ready.")


if __name__ == "__main__":
    main()

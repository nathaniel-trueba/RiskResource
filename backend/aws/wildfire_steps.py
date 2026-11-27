"""AWS Lambda handlers for the weekly wildfire pipeline, one per Step Functions step.

    fetch_chunk            Step 1 (inside a Map): NASA POWER weather for one slice of grid cells
    build_features         Step 2: Open-Meteo forecast + the model's feature table
    calibrate_and_publish  Step 3: run the model -> calibrated probabilities -> S3

The model itself takes under a second for 3,221 counties, so it runs inside the
last Lambda. No SageMaker.

They do the same work as ml/wildfire/predict_week.py, split so each piece fits in
Lambda's 15 minutes. The local script is unchanged and still works.

Every handler works out the week from the execution's start time ("startTime" in the
event, $$.Execution.StartTime in the state machine), never from the clock when it
runs. Every step and every retry of a run therefore agrees on the week and on the
date range downloaded, even if a retry happens hours later.

S3 layout (bucket from WILDFIRE_BUCKET):

    raw/{week}/power_{start}_{end}/{cell}.parquet   Weather downloads. A retry skips cells already here
    features/{week}/features.csv                    Model input: no header, in model feature order
    features/{week}/fips.json                       County FIPS for each CSV row, in order
    wildfire/weeks/{week}.json                      This week's published scores
    wildfire/latest.json                            What the backend reads (WILDFIRE_MODEL_URI)

Environment variables:

    WILDFIRE_BUCKET              Required. The pipeline's S3 bucket
    WILDFIRE_MODEL_URI           Where to publish. Default s3://{bucket}/wildfire/latest.json
    WILDFIRE_POWER_PER_MINUTE    NASA POWER requests per minute (default 60)
    WILDFIRE_POWER_WORKERS       Concurrent POWER requests (default 3)
    WILDFIRE_CHUNK_MAX_FAILED    Share of a chunk's cells allowed to fail before the
                                 chunk fails (default 0.05)

Packaged as a container image with ml/, weekly_scores/ and this file. See
aws/wildfire.Dockerfile and davanam-temp/aws-step-by-step/04-packaging.md.
"""

from __future__ import annotations

import io
import json
import logging
import os
import threading
import time
from concurrent.futures import FIRST_EXCEPTION, ThreadPoolExecutor, wait
from datetime import UTC, date, datetime, timedelta
from typing import Any

import httpx
import numpy as np
import pandas as pd

from ml.wildfire import sources
from ml.wildfire.config import ARTIFACTS_DIR
from ml.wildfire.model import WildfireModel
from ml.wildfire.predict_week import (
    FORECAST_PAST_DAYS,
    HISTORY_DAYS,
    current_week_start,
    fetch_forecast,
    publish,
    wide_daily,
)
from weekly_scores import WeeklyScores, open_store

logger = logging.getLogger()
logger.setLevel(logging.INFO)
logging.getLogger("httpx").setLevel(logging.WARNING)

# Leave this much of Lambda's time limit for saving and returning cleanly.
TIME_RESERVE_SECONDS = 90
# Concurrent S3 reads when loading every cell's weather.
S3_READ_WORKERS = 16


class Throttled(RuntimeError):
    """NASA POWER answered 429. The state machine retries the chunk after a wait."""


class ChunkIncomplete(RuntimeError):
    """The chunk ran out of time, or too many cells failed. A retry resumes it."""


# --------------------------------------------------------------------------- #
# Shared helpers
# --------------------------------------------------------------------------- #

_s3_client = None
_model: WildfireModel | None = None
_cells: pd.DataFrame | None = None


def _s3():
    """Return a boto3 S3 client, created once per container."""
    global _s3_client
    if _s3_client is None:
        import boto3

        _s3_client = boto3.client("s3")
    return _s3_client


def _bucket() -> str:
    """The pipeline bucket. Raises KeyError with a clear message if it isn't set."""
    try:
        return os.environ["WILDFIRE_BUCKET"]
    except KeyError:
        raise KeyError("Set the WILDFIRE_BUCKET environment variable on this Lambda") from None


def _load_model() -> WildfireModel:
    """Load the model and lookup tables once per container (they ship in the image)."""
    global _model
    if _model is None:
        _model = WildfireModel.load()
    return _model


def _all_cells() -> pd.DataFrame:
    """Every NASA POWER grid cell, indexed by cell id and sorted, with cell_lat and cell_lon.

    Read from the small county_cells table rather than loading the whole model, so
    fetch_chunk starts quickly. Sorted, so every chunk agrees on which cells it owns.
    """
    global _cells
    if _cells is None:
        county_cells = pd.read_parquet(ARTIFACTS_DIR / "county_cells.parquet")
        _cells = (
            county_cells.drop_duplicates("cell").set_index("cell")[["cell_lat", "cell_lon"]].sort_index()
        )
    return _cells


def _run_dates(event: dict[str, Any]) -> dict[str, date]:
    """Work out the week and every date range from the execution's start time.

    Args:
        event: Needs "startTime" (ISO 8601, from $$.Execution.StartTime). A manual
            test can pass "week" (a Monday) and optionally "today" instead.
    Returns:
        {"today", "week", "start", "end", "power_end", "forecast_start"}, matching
        what predict_week.score_week uses.
    """
    if event.get("startTime"):
        today = datetime.fromisoformat(event["startTime"].replace("Z", "+00:00")).astimezone(UTC).date()
    else:
        today = date.fromisoformat(event["today"]) if event.get("today") else datetime.now(UTC).date()
    week = date.fromisoformat(event["week"]) if event.get("week") else current_week_start(today)
    if week.weekday() != 0:
        raise ValueError(f"week must be a Monday, got {week}")
    end = week + timedelta(days=6)
    power_end = min(end, today)
    return {
        "today": today,
        "week": week,
        "start": week - timedelta(days=HISTORY_DAYS),
        "end": end,
        "power_end": power_end,
        "forecast_start": max(power_end - timedelta(days=14), today - timedelta(days=FORECAST_PAST_DAYS)),
    }


def _raw_prefix(d: dict[str, date]) -> str:
    """S3 prefix for this run's weather downloads, e.g. raw/2026-11-30/power_20260603_20261202/."""
    return f"raw/{d['week']}/power_{d['start']:%Y%m%d}_{d['power_end']:%Y%m%d}/"


def _existing_cells(prefix: str) -> set[str]:
    """Cell ids already downloaded under a prefix."""
    found: set[str] = set()
    for page in _s3().get_paginator("list_objects_v2").paginate(Bucket=_bucket(), Prefix=prefix):
        for obj in page.get("Contents", []):
            name = obj["Key"].rsplit("/", 1)[-1]
            if name.endswith(".parquet"):
                found.add(name[: -len(".parquet")])
    return found


def _put_parquet(key: str, frame: pd.DataFrame) -> None:
    """Write a DataFrame to S3 as parquet."""
    buffer = io.BytesIO()
    frame.to_parquet(buffer)
    _s3().put_object(Bucket=_bucket(), Key=key, Body=buffer.getvalue())


def _get_bytes(key: str) -> bytes:
    """Read an S3 object's bytes."""
    return _s3().get_object(Bucket=_bucket(), Key=key)["Body"].read()


def _remaining_seconds(context: Any) -> float:
    """Seconds left before Lambda stops this invocation (a large number outside Lambda)."""
    if context is not None and hasattr(context, "get_remaining_time_in_millis"):
        return context.get_remaining_time_in_millis() / 1000
    return float("inf")


# --------------------------------------------------------------------------- #
# Step 1: fetch_chunk
# --------------------------------------------------------------------------- #


def fetch_chunk(event: dict[str, Any], context: Any) -> dict[str, Any]:
    """Download NASA POWER weather for one slice of the grid cells into S3.

    Cells already in S3 for this run are skipped, so a retry only fetches what's
    missing. Requests are paced to WILDFIRE_POWER_PER_MINUTE and tried once each.

    Args:
        event: {"chunk": 3, "of": 8, "startTime": "..."} from the Map state.
        context: The Lambda context, used to stop before the time limit.
    Returns:
        {"week", "chunk", "cells", "downloaded", "alreadyThere", "failed"}.
    Raises:
        Throttled: NASA POWER returned 429. Downloads so far are kept.
        ChunkIncomplete: Out of time, or more than WILDFIRE_CHUNK_MAX_FAILED of the
            chunk's cells failed. Downloads so far are kept.
    """
    d = _run_dates(event)
    chunk, of = int(event["chunk"]), int(event["of"])
    if not 0 <= chunk < of:
        raise ValueError(f"chunk must be between 0 and {of - 1}, got {chunk}")
    all_cells = _all_cells()
    cells = all_cells.iloc[np.array_split(np.arange(len(all_cells)), of)[chunk]]
    prefix = _raw_prefix(d)
    done = _existing_cells(prefix)
    todo = [(cell, row.cell_lat, row.cell_lon) for cell, row in cells.iterrows() if cell not in done]
    logger.info(
        "Week %s, chunk %d/%d: %d cells, %d already in S3, %d to download (%s to %s)",
        d["week"], chunk + 1, of, len(cells), len(cells) - len(todo), len(todo), d["start"], d["power_end"],
    )

    per_minute = float(os.environ.get("WILDFIRE_POWER_PER_MINUTE", "60"))
    workers = int(os.environ.get("WILDFIRE_POWER_WORKERS", "3"))
    pacer = sources._Pacer(60 / per_minute)
    stop = threading.Event()  # Set on a 429 or when time runs short
    throttled = threading.Event()
    failed: list[str] = []
    downloaded = 0
    lock = threading.Lock()

    def work(cell: str, lat: float, lon: float) -> None:
        """Download one cell and save it, unless the chunk is stopping."""
        nonlocal downloaded
        if stop.is_set():
            return
        if _remaining_seconds(context) < TIME_RESERVE_SECONDS:
            stop.set()
            return
        try:
            frame = sources.fetch_power_cell(
                client, lat, lon, start=d["start"], end=d["power_end"], pacer=pacer, attempts=1
            )
        except httpx.HTTPStatusError as error:
            if error.response is not None and error.response.status_code == 429:
                throttled.set()
                stop.set()
                return
            logger.warning("Cell %s failed: %s", cell, error)
            with lock:
                failed.append(cell)
            return
        except (httpx.HTTPError, ValueError, KeyError) as error:
            logger.warning("Cell %s failed: %s", cell, error)
            with lock:
                failed.append(cell)
            return
        _put_parquet(f"{prefix}{cell}.parquet", frame)
        with lock:
            downloaded += 1

    with sources._client() as client, ThreadPoolExecutor(workers) as pool:
        futures = [pool.submit(work, *item) for item in todo]
        wait(futures, return_when=FIRST_EXCEPTION)
        stop.set()
        for future in futures:
            future.result()  # Re-raise unexpected errors (S3 writes)

    summary = {
        "week": d["week"].isoformat(),
        "chunk": chunk,
        "cells": len(cells),
        "downloaded": downloaded,
        "alreadyThere": len(cells) - len(todo),
        "failed": len(failed),
    }
    logger.info("Chunk summary: %s", json.dumps(summary))
    if throttled.is_set():
        raise Throttled(f"NASA POWER rate-limited chunk {chunk} after {downloaded} new cells")
    missing = len(todo) - downloaded - len(failed)
    if missing > 0:
        raise ChunkIncomplete(f"Chunk {chunk} ran out of time with {missing} cells left")
    max_failed = float(os.environ.get("WILDFIRE_CHUNK_MAX_FAILED", "0.05"))
    if failed and len(failed) > max_failed * len(cells):
        raise ChunkIncomplete(f"Chunk {chunk}: {len(failed)} of {len(cells)} cells failed")
    return summary


# --------------------------------------------------------------------------- #
# Step 2: build_features
# --------------------------------------------------------------------------- #


def build_features(event: dict[str, Any], context: Any) -> dict[str, Any]:
    """Fetch the forecast, build the model's features, and write them to S3.

    Args:
        event: {"startTime": "..."}.
        context: The Lambda context (unused).
    Returns:
        {"week", "featuresUri", "fipsUri", "counties", "dropped"}.
        calibrate_and_publish reads both files.
    Raises:
        ValueError: If no county has weather for the week.
    """
    started = time.monotonic()
    d = _run_dates(event)
    model = _load_model()
    cells = _all_cells()
    prefix = _raw_prefix(d)
    bucket = _bucket()

    present = sorted(_existing_cells(prefix))
    logger.info("Week %s: %d of %d cells downloaded", d["week"], len(present), len(cells))

    def read(cell: str) -> tuple[str, pd.DataFrame]:
        return cell, pd.read_parquet(io.BytesIO(_get_bytes(f"{prefix}{cell}.parquet")))

    with ThreadPoolExecutor(S3_READ_WORKERS) as pool:
        power = dict(pool.map(read, present))

    forecast = fetch_forecast(cells, d["forecast_start"], d["end"]) if d["forecast_start"] <= d["end"] else {}
    daily = wide_daily(power, forecast, cells.index, d["start"], d["end"])
    X = model.features_for_week(daily, pd.Timestamp(d["week"]))
    # Same rule as predict_week: without this week's weather, leave the county out.
    scored = X[X["week_tmax_mean"].notna()]
    if scored.empty:
        raise ValueError(f"No county has weather for the week of {d['week']}")

    features_key = f"features/{d['week']}/features.csv"
    fips_key = f"features/{d['week']}/fips.json"
    # No header, columns in model feature order, empty fields for missing values.
    # calibrate_and_publish reads it back with the model's column names.
    csv = scored[model.features].to_csv(header=False, index=False, na_rep="")
    _s3().put_object(Bucket=bucket, Key=features_key, Body=csv.encode("utf-8"), ContentType="text/csv")
    _s3().put_object(
        Bucket=bucket,
        Key=fips_key,
        Body=json.dumps([str(f) for f in scored.index]).encode("utf-8"),
        ContentType="application/json",
    )
    summary = {
        "week": d["week"].isoformat(),
        "featuresUri": f"s3://{bucket}/{features_key}",
        "fipsUri": f"s3://{bucket}/{fips_key}",
        "counties": len(scored),
        "dropped": len(X) - len(scored),
        "durationSeconds": round(time.monotonic() - started, 1),
    }
    logger.info("Features summary: %s", json.dumps(summary))
    return summary


# --------------------------------------------------------------------------- #
# Step 3: calibrate_and_publish
# --------------------------------------------------------------------------- #


def _read_features(week: str, model: WildfireModel) -> tuple[pd.DataFrame, list[str]]:
    """Read build_features' CSV back into a DataFrame with the model's columns, plus its FIPS list."""
    fips = json.loads(_get_bytes(f"features/{week}/fips.json"))
    X = pd.read_csv(
        io.BytesIO(_get_bytes(f"features/{week}/features.csv")),
        header=None,
        names=model.features,
        dtype="float32",
    )
    if len(X) != len(fips):
        raise ValueError(f"features.csv has {len(X)} rows but fips.json lists {len(fips)} counties")
    X.index = pd.Index(fips, name="fips")
    return X, fips


def calibrate_and_publish(event: dict[str, Any], context: Any) -> dict[str, Any]:
    """Run the model on the week's features, calibrate, and publish the probabilities.

    Args:
        event: {"week": "2026-11-30"}, the week build_features returned.
        context: The Lambda context (unused).
    Returns:
        {"week", "counties", "published", "weeklyCopy"}.
    """
    week = event["week"]
    model = _load_model()
    X, fips = _read_features(week, model)

    probability = model.calibrate(np.asarray(model.predict_raw(X), dtype="float32"))

    scores = WeeklyScores(
        week_start=date.fromisoformat(week),
        generated_at=datetime.now(UTC).isoformat(timespec="seconds"),
        model_trained_at=model.metadata.get("trained_at"),
        probabilities={
            f: float(f"{p:.6g}") for f, p in zip(fips, probability, strict=True) if np.isfinite(p)
        },
    )
    bucket = _bucket()
    latest = os.environ.get("WILDFIRE_MODEL_URI") or f"s3://{bucket}/wildfire/latest.json"
    weekly = f"s3://{bucket}/wildfire/weeks/{week}.json"
    # The weekly copy first: if publishing latest fails, the week is still saved.
    publish(scores, open_store(weekly))
    publish(scores, open_store(latest))
    summary = {
        "week": week,
        "counties": len(scores.probabilities),
        "medianProbabilityPct": round(100 * float(np.median(probability)), 4),
        "published": latest,
        "weeklyCopy": weekly,
    }
    logger.info("Publish summary: %s", json.dumps(summary))
    return summary

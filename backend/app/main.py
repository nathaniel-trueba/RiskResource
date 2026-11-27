"""FastAPI entry point. Run from backend/ with: uvicorn app.main:app --reload"""

import asyncio
import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import httpx
from fastapi import APIRouter, FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.clients.nwps import NwpsClient
from app.clients.nws import NwsClient
from app.clients.open_meteo import OpenMeteoClient
from app.clients.usgs import UsgsClient
from app.config import BACKEND_DIR, get_settings
from app.core.cache import TTLCache
from app.db import connect, initialize
from app.routers import counties, health, home_snapshot, map_values, search, states
from app.services.home_snapshot import load_home_snapshot
from app.services.reference import ReferenceData
from app.services.risk import RiskService
from app.services.search import SearchService
from app.services.wildfire_model import WildfireModelSource
from weekly_scores import open_store

logging.basicConfig(level=logging.INFO)
# httpx logs every request at INFO. Failed upstream calls are logged by the cache.
logging.getLogger("httpx").setLevel(logging.WARNING)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """Set up shared services at startup and close them at shutdown.

    Initializes the database if needed, loads the reference data, creates the HTTP
    client, cache and services, and starts warming the national snapshot.

    Args:
        app: The FastAPI app. Services are stored on app.state.
    Yields:
        Control to FastAPI while the app serves requests.
    Called by: FastAPI, as the lifespan passed in create_app.
    """
    settings = get_settings()
    # Creates tables and seeds them only on first run, then reads ~22k small rows once.
    def load_reference() -> ReferenceData:
        """Initialize the database if needed and read the reference data.

        Runs in a worker thread because psycopg's sync API blocks.

        Returns:
            The loaded ReferenceData.
        Called by: lifespan.
        """
        with connect(settings) as conn:
            initialize(conn, settings.reference_data_path)
            return ReferenceData.from_database(conn)

    reference = await asyncio.to_thread(load_reference)
    app.state.home_snapshot = load_home_snapshot(BACKEND_DIR / settings.home_snapshot_dir, reference)
    cache = TTLCache(settings.max_stale_seconds, settings.failure_cooldown_seconds)

    async with httpx.AsyncClient(
        headers={"User-Agent": settings.user_agent},
        timeout=settings.upstream_timeout_seconds,
        follow_redirects=True,
    ) as http:
        open_meteo = OpenMeteoClient(http)
        app.state.risk_service = RiskService(
            settings,
            cache,
            reference,
            NwsClient(http),
            UsgsClient(http),
            NwpsClient(http),
            open_meteo,
            WildfireModelSource(
                open_store(settings.wildfire_model_uri, base_dir=BACKEND_DIR),
                settings.wildfire_model_max_age_days,
            ),
        )
        app.state.search_service = SearchService(settings, cache, reference, open_meteo)

        # Fill the cache in the background so the first visitor doesn't wait for it.
        warm_up = asyncio.create_task(app.state.risk_service.get_snapshot())
        yield
        warm_up.cancel()


def create_app() -> FastAPI:
    """Build the FastAPI app with CORS and every router under /api.

    Returns:
        The configured app.
    Called by: this module, to create `app`, which uvicorn serves.
    """
    settings = get_settings()
    app = FastAPI(
        title="Risk Resource API",
        description="US natural disaster risk scores for the Risk Resource frontend.",
        lifespan=lifespan,
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_methods=["GET"],
        allow_headers=["*"],
    )

    api = APIRouter(prefix="/api")
    for module in (health, states, counties, map_values, search, home_snapshot):
        api.include_router(module.router)
    app.include_router(api)
    return app


app = create_app()

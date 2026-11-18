"""FastAPI dependencies. The services themselves are created in main.py at startup."""

from fastapi import Request

from app.services.risk import RiskService
from app.services.search import SearchService


def get_risk_service(request: Request) -> RiskService:
    """Return the RiskService created at startup.

    Args:
        request: The current request, injected by FastAPI.
    Returns:
        The app's single RiskService.
    Called by: FastAPI's Depends, in the counties, states, map_values and health routes.
    """
    return request.app.state.risk_service


def get_search_service(request: Request) -> SearchService:
    """Return the SearchService created at startup.

    Args:
        request: The current request, injected by FastAPI.
    Returns:
        The app's single SearchService.
    Called by: FastAPI's Depends, in the search route.
    """
    return request.app.state.search_service

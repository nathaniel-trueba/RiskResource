from typing import Annotated, Any

from fastapi import APIRouter, Depends, Request

from app.dependencies import get_risk_service
from app.services.risk import RiskService

router = APIRouter(tags=["health"])


@router.get("/health", summary="Service status and the state of each upstream source")
async def health(
    request: Request, risk: Annotated[RiskService, Depends(get_risk_service)]
) -> dict[str, Any]:
    """Report service status and the cache state of each upstream source.
    \f
    Args:
        request: The current request, for the ReferenceRefresher on app.state.
        risk: Injected RiskService.
    Returns:
        {"status": "ok", "sources": {source name: TTLCache.status() summary},
        "referenceData": ReferenceRefresher.status()}.
    Called by: HTTP GET /api/health.
    """
    return {
        "status": "ok",
        "sources": risk.source_status(),
        "referenceData": request.app.state.reference_refresher.status(),
    }

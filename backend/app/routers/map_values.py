from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query

from app.dependencies import get_risk_service
from app.domain.hazards import Hazard
from app.schemas import MapValue
from app.services.risk import InvalidMapQuery, MapLevel, MapMetric, RiskService

router = APIRouter(tags=["risk"])


@router.get(
    "/map-values",
    summary="One value per state or county, for colouring the map",
    response_model=list[MapValue],
)
async def get_map_values(
    risk: Annotated[RiskService, Depends(get_risk_service)],
    level: MapLevel = MapLevel.STATE,
    metric: MapMetric = MapMetric.COMPOSITE,
    hazard: Annotated[
        Hazard | None,
        Query(description="For lossPerPerson and totalLoss: limit the loss to one hazard"),
    ] = None,
) -> list[MapValue]:
    """Return one value per state or county, for colouring the map.
    \f
    Args:
        risk: Injected RiskService.
        level: Whether to return states or counties.
        metric: The composite score, a single hazard's score, or a loss metric.
        hazard: Optional hazard filter for lossPerPerson and totalLoss.
    Returns:
        One MapValue per area.
    Raises:
        HTTPException: 400 for a metric with an unsupported level or hazard.
    Called by: HTTP GET /api/map-values.
    """
    try:
        return await risk.get_map_values(level, metric, hazard)
    except InvalidMapQuery as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

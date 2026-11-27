from fastapi import APIRouter, HTTPException, Request

from app.schemas import HomeSnapshot

router = APIRouter(tags=["home"])


@router.get(
    "/home-snapshot",
    summary="Fixed state scores for the home page's hazard map animation",
    response_model=HomeSnapshot,
)
async def get_home_snapshot(request: Request) -> HomeSnapshot:
    """Return the fixed snapshot loaded from data/snapshot/ at startup.
    \f
    Args:
        request: The current request, for the snapshot stored on app.state.
    Returns:
        State scores by hazard, each with its date.
    Raises:
        HTTPException: 503 if no snapshot file could be read.
    Called by: HTTP GET /api/home-snapshot.
    """
    snapshot = request.app.state.home_snapshot
    if snapshot is None:
        raise HTTPException(status_code=503, detail="Home snapshot unavailable")
    return snapshot

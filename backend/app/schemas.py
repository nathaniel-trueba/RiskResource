"""API response models.

These mirror frontend/lib/types.ts, and JSON field names are camelCase to match
it. If you change one side, change the other.
"""

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel

from app.domain.scoring import Tier


class ApiModel(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


class HazardItem(ApiModel):
    name: str
    score: int = Field(ge=0, le=100)
    tier: Tier
    warning: str


class HazardLoss(ApiModel):
    name: str  # Hazard label, e.g. "Severe Storm"
    amount: float = Field(ge=0)  # Dollars per year


class ExpectedLoss(ApiModel):
    """FEMA National Risk Index expected annual loss, from the hazards this app tracks.

    Covers 11 of NRI's 18 hazards, those that match ours. Includes building and
    agriculture losses, plus deaths and injuries at FEMA's dollar value.
    """

    total: float = Field(ge=0)  # Dollars per year
    per_person: float | None = None  # Dollars per resident per year
    by_hazard: list[HazardLoss]  # Largest first
    # Counties at or above this loss per person count as high-loss
    high_loss_threshold_per_person: float
    high_loss_percentile: int  # The national percentile that threshold is at, e.g. 80
    source: str  # e.g. "FEMA National Risk Index, December 2025"


class CountyExpectedLoss(ExpectedLoss):
    loss_per_person_percentile: int | None = None  # Rank among all NRI counties, 0 to 100
    is_high_loss: bool
    social_vulnerability: str | None = None  # NRI rating, e.g. "Relatively High"
    community_resilience: str | None = None


class StateExpectedLoss(ExpectedLoss):
    high_loss_population_pct: float | None = None  # % of residents in high-loss counties


class StateRecord(ApiModel):
    code: str
    name: str
    composite_score: int = Field(ge=0, le=100)
    tier: Tier
    counties_count: int
    population: str  # Preformatted, e.g. "39,501,350"
    active_alert_count: int | None = None  # Omitted when the NWS feed is unavailable
    primary_alert: str | None = None  # Omitted when there are no active alerts
    hazards: list[HazardItem]  # Highest score first
    expected_loss: StateExpectedLoss | None = None  # Omitted when NRI has no data


class CountyRecord(ApiModel):
    name: str  # Includes the suffix, e.g. "Riverside County"
    state: str  # Full state name, e.g. "California"
    state_code: str  # Two letters, e.g. "CA"
    composite_score: int = Field(ge=0, le=100)
    tier: Tier
    fips: str  # Five characters with leading zero, e.g. "06065"
    pop: str  # Preformatted, e.g. "2,458,395"
    active_alert: str | None = None  # Omitted when there are no active alerts
    hazards: list[HazardItem]  # Highest score first
    # Omitted when NRI has no county data, e.g. Connecticut, which NRI reports by
    # planning region instead
    expected_loss: CountyExpectedLoss | None = None


class MapValue(ApiModel):
    """One map polygon's value."""

    id: str  # State code or FIPS, matching the frontend's GeoJSON feature ID
    # A 0 to 100 score, dollars (loss metrics) or a percent (highLossPct)
    value: float = Field(ge=0)
    tier: Tier | None = None  # Only for score metrics


class SearchResult(ApiModel):
    """One search match."""

    fips: str
    name: str
    state: str
    state_code: str
    matched_place: str | None = None  # Set when a city or ZIP led to this county

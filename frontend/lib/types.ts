// frontend/lib/types.ts
// Mirrors backend/app/schemas.py. If you change one side, change the other.

export type Tier = 'Low' | 'Moderate' | 'Elevated' | 'Critical';

export interface HazardItem {
  name: string;
  score: number;       // 0 to 100
  tier: Tier;
  warning: string;
}

export interface HazardLoss {
  name: string;        // Hazard label, e.g. "Severe Storm"
  amount: number;      // Dollars per year
}

// FEMA National Risk Index expected annual loss, from the 11 NRI hazards that match
// ours. Includes building and agriculture losses, plus deaths and injuries at FEMA's
// dollar value.
export interface ExpectedLoss {
  total: number;                      // Dollars per year
  perPerson?: number;                 // Dollars per resident per year
  byHazard: HazardLoss[];             // Largest first
  highLossThresholdPerPerson: number; // Counties at or above this per person are "high-loss"
  highLossPercentile: number;         // The national percentile of that threshold, e.g. 80
  source: string;                     // e.g. "FEMA National Risk Index, December 2025"
}

export interface CountyExpectedLoss extends ExpectedLoss {
  lossPerPersonPercentile?: number;   // Rank among all NRI counties, 0 to 100
  isHighLoss: boolean;
  socialVulnerability?: string;       // NRI rating, e.g. "Relatively High"
  communityResilience?: string;
}

export interface StateExpectedLoss extends ExpectedLoss {
  highLossPopulationPct?: number;     // % of residents in high-loss counties
}

// The wildfire model's part of the overall score (20% of it). See SCORE_WEIGHTS.
export interface WildfireModelInfo {
  score: number;        // 0 to 100, from the weekly probability on a log scale
  tier: Tier;
  probability?: number; // Chance a large wildfire starts in the county this week, 0 to 1. Counties only.
  weekStart: string;    // The Monday of the forecast week, e.g. "2026-11-23"
}

export interface StateRecord {
  code: string;
  name: string;
  row?: number;        // Grid position, only used by CartogramGrid
  col?: number;
  // Overall score: 40% historical, 40% live (through the hazard scores) and 20%
  // wildfire model. The hazard composite alone when wildfireModel is omitted.
  compositeScore: number;
  tier: Tier;
  countiesCount: number;
  population: string;
  activeAlertCount?: number;
  primaryAlert?: string;
  alerts?: string[];   // Deduplicated active statewide alerts, primary first
  hazards: HazardItem[];
  wildfireModel?: WildfireModelInfo;  // Population-weighted. Omitted when the model file is missing or stale
  expectedLoss?: StateExpectedLoss;   // Omitted when NRI has no data
}

export interface CountyRecord {
  name: string;
  state: string;
  stateCode?: string;  // Two letters, e.g. "CA"
  compositeScore: number;  // Overall score, as for StateRecord
  tier: Tier;
  fips?: string;
  pop: string;
  activeAlert?: string;
  alerts?: string[];   // Deduplicated active county alerts, most important first
  hazards: HazardItem[];
  wildfireModel?: WildfireModelInfo;  // Omitted when the model is unavailable for the county
  // Omitted when NRI has no county data, e.g. Connecticut, which NRI reports by
  // planning region instead
  expectedLoss?: CountyExpectedLoss;
}

// One map polygon's value, from GET /api/map-values
export interface MapValue {
  id: string;          // State code or county FIPS, matching the GeoJSON feature id
  value: number;       // A 0 to 100 score, dollars (loss metrics) or a percent (highLossPct)
  tier?: Tier | null;  // Only for score metrics
}

// One hazard's fixed state scores for the home page map, from GET /api/home-snapshot
export interface SnapshotLayer {
  kind: 'week' | 'day'; // 'week': a weekly model forecast; 'day': scores saved on one day
  asOf: string;         // YYYY-MM-DD: the week's Monday, or the day the scores were saved
  values: MapValue[];   // One per state code
}

export interface HomeSnapshot {
  hazards: Record<string, SnapshotLayer>; // By hazard key, e.g. "wildfire"
}

// One search match, from GET /api/search
export interface SearchResult {
  fips: string;
  name: string;
  state: string;
  stateCode: string;
  matchedPlace?: string;  // Set when a city or ZIP led to this county
}

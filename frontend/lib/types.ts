// frontend/lib/types.ts

export interface TopHazard {
  hazard: string;
  eal: number;
}

export interface FemaStateRecord {
  name: string;
  population: number;
  counties: number;
  eal_total: number;
  eal_per_person: number | null;
  pct_pop_high_risk: number | null;
  high_risk_counties: number;
  top_hazards: TopHazard[];
}

export interface FemaCountyRecord {
  name: string;
  state: string;
  population: number | null;
  risk_score: number | null;
  risk_rating: string;
  eal_total: number | null;
  eal_per_person: number | null;
  sovi_score: number | null;
  resl_score: number | null;
  top_hazards: TopHazard[];
}

export interface RiskDataPayload {
  source: string;
  version: string;
  states: Record<string, FemaStateRecord>;
  counties: Record<string, FemaCountyRecord>;
}

export type MapViewMode = 'states' | 'counties';

export interface MetricOption {
  key: string;
  label: string;
  categorical?: boolean;
  palette?: string[];
  fmt?: (v: number) => string;
}

// --- Map Page Backend Payload (FIPS-keyed) ---

export interface MapHazardScores {
  wildfire: number;   // 0 - 100
  earthquake: number; // 0 - 100
  flood: number;      // 0 - 100
  hurricane: number;  // 0 - 100
  tornado: number;    // 0 - 100
}

export interface MapLocationMetrics {
  risk: number;               // 0 - 100 overall score
  loss: number;               // Expected annual loss per person ($/yr)
  sovi: number;               // 0 - 100 social vulnerability
  resil: number;              // 0 - 100 community resilience
  hz: MapHazardScores;        // Per-hazard 0 - 100 sub-scores
  name?: string;              // Optional display name
  state?: string;             // Optional state abbreviation
  active_alerts?: string[];   // Optional live NWS alert titles
  updated_at?: string;        // Optional ISO-8601 timestamp
}

export interface MapScoresResponse {
  counties: Record<string, MapLocationMetrics>; // Keyed by 5-digit FIPS (e.g. "06065")
  states?: Record<string, MapLocationMetrics>;  // Keyed by 2-digit FIPS (e.g. "06")
  updated_at?: string;
}

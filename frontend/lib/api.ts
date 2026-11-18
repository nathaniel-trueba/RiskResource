// frontend/lib/api.ts
// Client for the FastAPI backend. Response shapes are in lib/types.ts and mirror
// backend/app/schemas.py.

import { CountyRecord, MapValue, SearchResult, StateRecord } from '@/lib/types';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000/api';

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`);
  if (!res.ok) {
    throw new Error(`${path} failed with HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

/** Risk details for one state, by two-letter code (e.g. "CA"). */
export function fetchState(code: string): Promise<StateRecord> {
  return getJson<StateRecord>(`/states/${encodeURIComponent(code)}`);
}

/** Risk details for one county, by five-digit FIPS code (e.g. "06065"). */
export function fetchCounty(fips: string): Promise<CountyRecord> {
  return getJson<CountyRecord>(`/counties/${encodeURIComponent(fips)}`);
}

/** Hazard codes, as the backend names them. */
export type HazardKey = 'wildfire' | 'earthquake' | 'flood' | 'severeStorm' | 'hurricane' | 'tornado';

/** Expected annual loss metrics, from FEMA's National Risk Index. */
export type LossMetric = 'lossPerPerson' | 'totalLoss' | 'highLossPct';

/** Map metrics the backend accepts: the composite score, one hazard's score, or a loss metric. */
export type MapMetric = 'compositeScore' | HazardKey | LossMetric;

/**
 * One value per state (keyed by postal code) or county (keyed by FIPS), for
 * colouring the map. `hazard` limits lossPerPerson and totalLoss to one hazard.
 * Loss metrics leave out areas without NRI data.
 */
export async function fetchMapValues(
  level: 'state' | 'county',
  metric: MapMetric,
  hazard?: HazardKey
): Promise<Record<string, MapValue>> {
  const hazardParam = hazard ? `&hazard=${hazard}` : '';
  const values = await getJson<MapValue[]>(
    `/map-values?level=${level}&metric=${metric}${hazardParam}`
  );
  return Object.fromEntries(values.map((v) => [v.id, v]));
}

/** Counties matching a county name, city or ZIP code, best match first. */
export function searchCounties(query: string, limit = 8): Promise<SearchResult[]> {
  return getJson<SearchResult[]>(`/search?q=${encodeURIComponent(query)}&limit=${limit}`);
}

// frontend/lib/riskColors.ts
// Shared colour scales for map values, and the hazard names the UI shows.

import { HazardKey } from '@/lib/api';
import { Tier } from '@/lib/types';

/** One legend band: values at or above `min` (and below the next band) get `color`. */
export interface Band {
  min: number;
  label: string;
  color: string;
}

// Light to dark, lowest band first
const RAMP = ['#fef3cc', '#f2cf7c', '#e3a24e', '#d07a39', '#b24e28', '#7a221b'];

/**
 * Lowest score for each tier, highest first. Mirrors TIER_FLOORS in
 * backend/app/domain/scoring.py. If you change one side, change the other.
 * Prefer the `tier` the API returns; use tierFor only for scores computed here.
 */
export const TIER_FLOORS: { min: number; tier: Tier }[] = [
  { min: 75, tier: 'Critical' },
  { min: 50, tier: 'Elevated' },
  { min: 30, tier: 'Moderate' },
  { min: 0, tier: 'Low' },
];

/** Tier name for a 0 to 100 score, same rule as the backend's tier_for. */
export function tierFor(score: number): Tier {
  return TIER_FLOORS.find((floor) => score >= floor.min)?.tier ?? 'Low';
}

/**
 * One colour per tier, for badges, score bars and rings. `color` is the fill,
 * `text` is readable on it, and `range` is the score range for legends.
 */
export const TIER_STYLES: Record<Tier, { color: string; text: string; range: string }> = {
  Low: { color: RAMP[1], text: '#111827', range: '0–29' },
  Moderate: { color: RAMP[3], text: '#111827', range: '30–49' },
  Elevated: { color: RAMP[4], text: '#ffffff', range: '50–74' },
  Critical: { color: RAMP[5], text: '#ffffff', range: '75–100' },
};

/** Tiers lowest first, for legends. */
export const TIERS: Tier[] = ['Low', 'Moderate', 'Elevated', 'Critical'];

/**
 * Score bands for map fills. Every tier boundary (30, 50, 75) is a band
 * boundary, so a fill never disagrees with the tier in the tooltip. Most real
 * scores are under 50 (half of each hazard score is live, and that's 0 when
 * nothing is happening), so Low and Moderate are each split into a lighter and
 * a darker shade to keep variation on the map. Elevated and Critical use the
 * same colour as TIER_STYLES.
 */
export const SCORE_BANDS: Band[] = [
  { min: 0, label: 'Low 0–14', color: RAMP[0] },
  { min: 15, label: 'Low 15–29', color: RAMP[1] },
  { min: 30, label: 'Moderate 30–39', color: RAMP[2] },
  { min: 40, label: 'Moderate 40–49', color: RAMP[3] },
  { min: 50, label: 'Elevated 50–74', color: RAMP[4] },
  { min: 75, label: 'Critical 75–100', color: RAMP[5] },
];

export const NO_DATA_COLOR = '#d1d5db';

/** Fill colour for a value, or the no-data grey when there's no value. */
export function bandColor(value: number | undefined, bands: Band[]): string {
  if (value === undefined) return NO_DATA_COLOR;
  let color = bands[0].color;
  for (const band of bands) {
    if (value >= band.min) color = band.color;
  }
  return color;
}

/** Fill colour for a 0 to 100 score. */
export function scoreColor(score: number | undefined): string {
  return bandColor(score, SCORE_BANDS);
}

// Five steps of the same ramp, for quintiles
const QUANTILE_RAMP = [RAMP[0], RAMP[1], RAMP[2], RAMP[4], RAMP[5]];

/**
 * Five bands with about the same number of areas in each (quintiles), for values
 * without a fixed scale, such as dollars. Labels use `format`, e.g. "$336 – $425".
 */
export function quantileBands(values: number[], format: (value: number) => string): Band[] {
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 0) return [{ min: 0, label: 'No data', color: QUANTILE_RAMP[0] }];
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
  const cuts = [sorted[0], at(0.2), at(0.4), at(0.6), at(0.8)];
  const bands: Band[] = [];
  cuts.forEach((min, i) => {
    // Skip a cut that repeats the previous one, as happens when many areas are $0
    if (i > 0 && min <= cuts[i - 1]) return;
    bands.push({ min, label: '', color: QUANTILE_RAMP[i] });
  });
  bands.forEach((band, i) => {
    const next = bands[i + 1];
    band.label = next ? `${format(band.min)} – ${format(next.min)}` : `${format(band.min)} +`;
  });
  return bands;
}

/** Hazard buttons in display order. `key` is null for "All hazards". */
export const HAZARDS: { label: string; key: HazardKey | null }[] = [
  { label: 'All hazards', key: null },
  { label: 'Wildfire', key: 'wildfire' },
  { label: 'Earthquake', key: 'earthquake' },
  { label: 'Flood', key: 'flood' },
  { label: 'Severe Storm', key: 'severeStorm' },
  { label: 'Hurricane', key: 'hurricane' },
  { label: 'Tornado', key: 'tornado' },
];

/** Accent colour per hazard name, as the backend labels them (e.g. "Severe Storm"). */
export const HAZARD_COLORS: Record<string, string> = {
  Wildfire: '#e65100',
  Earthquake: '#c49a45',
  Flood: '#4a72b2',
  'Severe Storm': '#6b7f99',
  Hurricane: '#2a9d8f',
  Tornado: '#7b52ab',
};

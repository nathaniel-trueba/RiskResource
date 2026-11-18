// frontend/lib/riskColors.ts
// Shared colour scales for map values, and the hazard names the UI shows.

import { HazardKey } from '@/lib/api';

/** One legend band: values at or above `min` (and below the next band) get `color`. */
export interface Band {
  min: number;
  label: string;
  color: string;
}

// Light to dark, lowest band first
const RAMP = ['#fef3cc', '#e5ab58', '#ca6834', '#a23924', '#7a221b'];

/**
 * Score bands for map fills. Real scores mostly fall between 0 and 50 (half of
 * each score is a live signal, which is 0 when nothing is happening), so bands of
 * 10 show more variation than the tier boundaries at 30, 50 and 75.
 */
export const SCORE_BANDS: Band[] = [
  { min: 0, label: '0 – 9', color: RAMP[0] },
  { min: 10, label: '10 – 19', color: RAMP[1] },
  { min: 20, label: '20 – 29', color: RAMP[2] },
  { min: 30, label: '30 – 39', color: RAMP[3] },
  { min: 40, label: '40 +', color: RAMP[4] },
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

/**
 * Five bands with about the same number of areas in each (quintiles), for values
 * without a fixed scale, such as dollars. Labels use `format`, e.g. "$336 – $425".
 */
export function quantileBands(values: number[], format: (value: number) => string): Band[] {
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 0) return [{ min: 0, label: 'No data', color: RAMP[0] }];
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
  const cuts = [sorted[0], at(0.2), at(0.4), at(0.6), at(0.8)];
  const bands: Band[] = [];
  cuts.forEach((min, i) => {
    // Skip a cut that repeats the previous one, as happens when many areas are $0
    if (i > 0 && min <= cuts[i - 1]) return;
    bands.push({ min, label: '', color: RAMP[i] });
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

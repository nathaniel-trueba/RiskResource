// frontend/lib/scoring.ts
// How the overall risk score is built. Mirrors backend/app/domain/scoring.py
// (OVERALL_*_WEIGHT). If you change one side, change the other.

import { WildfireModelInfo } from '@/lib/types';

/** Shares of the overall score, in percent. */
export const SCORE_WEIGHTS = {
  historical: 40, // FEMA declarations (USGS quakes for earthquakes), inside each hazard score
  live: 40,       // NWS, USGS, Open-Meteo and NWPS signals, inside each hazard score
  wildfireModel: 20, // The weekly wildfire ignition model, added to the overall score only
} as const;

/** One line for legends and footers. */
export const SCORE_FORMULA =
  `Overall: ${SCORE_WEIGHTS.historical}% history, ${SCORE_WEIGHTS.live}% live conditions, ` +
  `${SCORE_WEIGHTS.wildfireModel}% wildfire model.`;

/** "Week of Nov 23" from an ISO date. */
export function formatWeek(weekStart: string): string {
  const date = new Date(`${weekStart}T00:00:00Z`);
  return `Week of ${date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })}`;
}

/** The model's line under a score, e.g. "0.42% chance of a large fire starting · Week of Nov 23". */
export function describeWildfireModel(model: WildfireModelInfo): string {
  const week = formatWeek(model.weekStart);
  if (model.probability === undefined) return `${week}`;
  const pct = 100 * model.probability;
  const shown = pct < 0.01 ? '<0.01%' : pct < 1 ? `${pct.toFixed(2)}%` : `${pct.toFixed(1)}%`;
  return `${shown} chance a large wildfire starts this week · ${week}`;
}

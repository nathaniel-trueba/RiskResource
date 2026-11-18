// frontend/lib/format.ts
// Number formatting shared by the map, legend and side panels.

/** Dollars, compact for large values: $447, $35.4M, $28.5B. */
export function formatUsd(amount: number): string {
  if (amount >= 1e9) return `$${(amount / 1e9).toFixed(1)}B`;
  if (amount >= 1e6) return `$${(amount / 1e6).toFixed(1)}M`;
  if (amount >= 1e4) return `$${Math.round(amount / 1e3)}K`;
  return `$${Math.round(amount).toLocaleString('en-US')}`;
}

/** A percent with one decimal below 10, e.g. "4.2%" or "62%". */
export function formatPct(pct: number): string {
  return `${pct < 10 && pct > 0 ? pct.toFixed(1) : Math.round(pct)}%`;
}

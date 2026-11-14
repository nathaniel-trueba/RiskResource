// frontend/lib/mockRiskData.ts
import { RiskDataPayload, MetricOption } from './types';

export const SEQ = ['#fff3c4', '#fdc666', '#f98a3c', '#e04a26', '#a51d14']; // low -> high risk
export const SEQ_GOOD = ['#e9f2f7', '#b6d3e6', '#7aaed1', '#3f7fb5', '#1d4f87']; // low -> high resilience
export const NO_DATA = '#d6d6d6';

export const RATINGS = [
  { label: 'Very High', color: '#a51d14' },
  { label: 'Relatively High', color: '#e04a26' },
  { label: 'Relatively Moderate', color: '#f98a3c' },
  { label: 'Relatively Low', color: '#fdc666' },
  { label: 'Very Low', color: '#fff3c4' },
  { label: 'Insufficient Data', color: '#cfcfcf' },
  { label: 'No Rating', color: '#cfcfcf' },
];

export function money(v: number | null | undefined): string {
  if (v == null || Number.isNaN(v)) return '-';
  const a = Math.abs(v);
  if (a >= 1e9) return `$${(v / 1e9).toFixed(1)}B`;
  if (a >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `$${(v / 1e3).toFixed(1)}K`;
  return `$${Math.round(v).toLocaleString()}`;
}

export const fmtInt = (v: number | null | undefined): string =>
  v == null ? '-' : v.toLocaleString();

export const METRICS: Record<'states' | 'counties', MetricOption[]> = {
  states: [
    { key: 'eal_per_person', label: 'Expected annual loss per person', fmt: (v) => money(v), palette: SEQ },
    { key: 'pct_pop_high_risk', label: '% of people in high-risk counties', fmt: (v) => `${v}%`, palette: SEQ },
    { key: 'eal_total', label: 'Total expected annual loss', fmt: (v) => money(v), palette: SEQ },
  ],
  counties: [
    { key: 'risk_rating', label: 'FEMA risk rating', categorical: true },
    { key: 'risk_score', label: 'FEMA risk score (0-100)', fmt: (v) => v.toFixed(1), palette: SEQ },
    { key: 'eal_per_person', label: 'Expected annual loss per person', fmt: (v) => money(v), palette: SEQ },
    { key: 'sovi_score', label: 'Social vulnerability (0-100)', fmt: (v) => v.toFixed(1), palette: SEQ },
    { key: 'resl_score', label: 'Community resilience (0-100)', fmt: (v) => v.toFixed(1), palette: SEQ_GOOD },
  ],
};

export const BOUNDARIES_URL = 'https://cdn.jsdelivr.net/npm/us-atlas@3.0.1/counties-10m.json';

export const STATE_FIPS_ON_MAP = new Set([
  '01','02','04','05','06','08','09','10','11','12','13','15','16','17','18',
  '19','20','21','22','23','24','25','26','27','28','29','30','31','32','33',
  '34','35','36','37','38','39','40','41','42','44','45','46','47','48','49',
  '50','51','53','54','55','56','72'
]);

export const RISK_DATA: RiskDataPayload = {
  source: 'FEMA National Risk Index',
  version: 'December 2025',
  states: {
    '01': { name: 'Alabama', population: 5014878, counties: 67, eal_total: 2505515583, eal_per_person: 499.62, pct_pop_high_risk: 34.0, high_risk_counties: 4, top_hazards: [{ hazard: 'Inland Flooding', eal: 1082049518 }, { hazard: 'Hurricane', eal: 466138377 }, { hazard: 'Tornado', eal: 427417131 }] },
    '02': { name: 'Alaska', population: 731719, counties: 30, eal_total: 941279955, eal_per_person: 1286.4, pct_pop_high_risk: 39.8, high_risk_counties: 1, top_hazards: [{ hazard: 'Earthquake', eal: 663948695 }, { hazard: 'Cold Wave', eal: 79668036 }, { hazard: 'Avalanche', eal: 60946079 }] },
    '04': { name: 'Arizona', population: 7144933, counties: 15, eal_total: 3600040399, eal_per_person: 503.86, pct_pop_high_risk: 79.4, high_risk_counties: 3, top_hazards: [{ hazard: 'Inland Flooding', eal: 1984981267 }, { hazard: 'Heat Wave', eal: 1182218243 }, { hazard: 'Wildfire', eal: 228349137 }] },
    '05': { name: 'Arkansas', population: 3007951, counties: 75, eal_total: 1769473868, eal_per_person: 588.27, pct_pop_high_risk: 13.3, high_risk_counties: 1, top_hazards: [{ hazard: 'Inland Flooding', eal: 627672451 }, { hazard: 'Earthquake', eal: 331361342 }, { hazard: 'Tornado', eal: 288076682 }] },
    '06': { name: 'California', population: 39501350, counties: 58, eal_total: 30211220241, eal_per_person: 764.81, pct_pop_high_risk: 94.4, high_risk_counties: 31, top_hazards: [{ hazard: 'Earthquake', eal: 14853246576 }, { hazard: 'Inland Flooding', eal: 11662338119 }, { hazard: 'Wildfire', eal: 1787365372 }] },
    '08': { name: 'Colorado', population: 5768835, counties: 64, eal_total: 2165285332, eal_per_person: 375.34, pct_pop_high_risk: 22.5, high_risk_counties: 2, top_hazards: [{ hazard: 'Inland Flooding', eal: 960202524 }, { hazard: 'Hail', eal: 341473280 }, { hazard: 'Wildfire', eal: 211174415 }] },
    '09': { name: 'Connecticut', population: 3604191, counties: 9, eal_total: 1212876303, eal_per_person: 336.52, pct_pop_high_risk: 60.1, high_risk_counties: 3, top_hazards: [{ hazard: 'Inland Flooding', eal: 858483239 }, { hazard: 'Hurricane', eal: 184139339 }, { hazard: 'Earthquake', eal: 36895448 }] },
    '10': { name: 'Delaware', population: 989008, counties: 3, eal_total: 377267129, eal_per_person: 381.46, pct_pop_high_risk: 57.6, high_risk_counties: 1, top_hazards: [{ hazard: 'Inland Flooding', eal: 216612247 }, { hazard: 'Hurricane', eal: 51808239 }, { hazard: 'Cold Wave', eal: 37626277 }] },
    '11': { name: 'District of Columbia', population: 688888, counties: 1, eal_total: 292473701, eal_per_person: 424.56, pct_pop_high_risk: 100.0, high_risk_counties: 1, top_hazards: [{ hazard: 'Inland Flooding', eal: 130058370 }, { hazard: 'Earthquake', eal: 61061319 }, { hazard: 'Heat Wave', eal: 39696332 }] },
    '12': { name: 'Florida', population: 21506751, counties: 67, eal_total: 8785878961, eal_per_person: 408.52, pct_pop_high_risk: 78.6, high_risk_counties: 21, top_hazards: [{ hazard: 'Hurricane', eal: 4277265867 }, { hazard: 'Inland Flooding', eal: 2781288362 }, { hazard: 'Tornado', eal: 529539231 }] },
  },
  counties: {
    '06065': { name: 'Riverside County', state: 'California', population: 2418185, risk_score: 98.4, risk_rating: 'Very High', eal_total: 1849911525, eal_per_person: 765.0, sovi_score: 64.2, resl_score: 52.1, top_hazards: [{ hazard: 'Earthquake', eal: 920000000 }, { hazard: 'Wildfire', eal: 540000000 }, { hazard: 'Inland Flooding', eal: 210000000 }] },
    '06097': { name: 'Sonoma County', state: 'California', population: 488863, risk_score: 94.1, risk_rating: 'Very High', eal_total: 412111509, eal_per_person: 843.0, sovi_score: 48.5, resl_score: 61.3, top_hazards: [{ hazard: 'Wildfire', eal: 215000000 }, { hazard: 'Earthquake', eal: 145000000 }, { hazard: 'Inland Flooding', eal: 52111509 }] },
    '06019': { name: 'Fresno County', state: 'California', population: 1008654, risk_score: 91.2, risk_rating: 'Relatively High', eal_total: 615278940, eal_per_person: 610.0, sovi_score: 78.9, resl_score: 44.0, top_hazards: [{ hazard: 'Inland Flooding', eal: 310000000 }, { hazard: 'Wildfire', eal: 180000000 }, { hazard: 'Earthquake', eal: 95000000 }] },
    '06073': { name: 'San Diego County', state: 'California', population: 3298634, risk_score: 96.8, risk_rating: 'Very High', eal_total: 2144112100, eal_per_person: 650.0, sovi_score: 55.4, resl_score: 58.7, top_hazards: [{ hazard: 'Earthquake', eal: 1120000000 }, { hazard: 'Wildfire', eal: 680000000 }, { hazard: 'Inland Flooding', eal: 190000000 }] },
    '06037': { name: 'Los Angeles County', state: 'California', population: 10014009, risk_score: 100.0, risk_rating: 'Very High', eal_total: 8411767560, eal_per_person: 840.0, sovi_score: 72.1, resl_score: 51.8, top_hazards: [{ hazard: 'Earthquake', eal: 5600000000 }, { hazard: 'Wildfire', eal: 1200000000 }, { hazard: 'Inland Flooding', eal: 980000000 }] },
  },
};

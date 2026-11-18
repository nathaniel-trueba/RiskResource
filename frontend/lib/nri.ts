// frontend/lib/nri.ts
// What the expected loss figures do and don't include, shown wherever they appear.
// Keep in sync with NRI_HAZARDS and NRI_EXCLUDED_HAZARDS in backend/app/domain/hazards.py.

/** NRI hazards counted toward each of our hazards. */
export const NRI_HAZARDS_INCLUDED: Record<string, string> = {
  Wildfire: 'Wildfire',
  Earthquake: 'Earthquake',
  Flood: 'Inland and coastal flooding',
  'Severe Storm': 'Strong wind, hail, lightning, ice storm, winter weather',
  Hurricane: 'Hurricane',
  Tornado: 'Tornado',
};

/** NRI hazards with no match here, left out of every loss figure. */
export const NRI_HAZARDS_EXCLUDED = [
  'drought',
  'heat wave',
  'cold wave',
  'landslide',
  'avalanche',
  'tsunami',
  'volcanic activity',
];

export const NRI_LINK = 'https://hazards.fema.gov/nri/';

/** One-sentence summary of what "expected annual loss" means here. */
export const EXPECTED_LOSS_NOTE =
  "FEMA's modeled average yearly loss to buildings and crops, plus deaths and injuries at " +
  "FEMA's dollar value. It's an estimate, not money actually lost. Covers 11 of NRI's 18 " +
  `hazards; leaves out ${NRI_HAZARDS_EXCLUDED.join(', ')}.`;

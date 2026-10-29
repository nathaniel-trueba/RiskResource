// Data loading. Everything the map needs comes through these two functions,
// so switching to the backend later only touches this file and config.js.

async function loadRiskData() {
  const { API_BASE } = window.APP_CONFIG;
  if (API_BASE) {
    const res = await fetch(`${API_BASE}/risk`);
    if (!res.ok) throw new Error(`Risk API returned ${res.status}`);
    return res.json();
  }
  if (!window.RISK_DATA) throw new Error("data/risk-data.js is missing - run scripts/build_data.py");
  return window.RISK_DATA;
}

async function loadBoundaries() {
  const { BOUNDARIES_URL, STATE_FIPS_ON_MAP } = window.APP_CONFIG;
  const res = await fetch(BOUNDARIES_URL);
  if (!res.ok) throw new Error(`Boundary file returned ${res.status}`);
  const topo = await res.json();

  const keep = new Set(STATE_FIPS_ON_MAP);
  const states = topojson.feature(topo, topo.objects.states);
  const counties = topojson.feature(topo, topo.objects.counties);
  states.features = states.features.filter(f => keep.has(String(f.id)));
  counties.features = counties.features.filter(f => keep.has(String(f.id).slice(0, 2)));
  return { states, counties };
}

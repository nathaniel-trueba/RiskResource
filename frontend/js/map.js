// Risk Resource - main map logic (Leaflet choropleth)

// ------------------------------------------------------------------
// Metrics shown in the "Show" dropdown, per view
// ------------------------------------------------------------------
const SEQ = ["#fff3c4", "#fdc666", "#f98a3c", "#e04a26", "#a51d14"];   // low -> high risk
const SEQ_GOOD = ["#e9f2f7", "#b6d3e6", "#7aaed1", "#3f7fb5", "#1d4f87"]; // low -> high resilience

const RATINGS = [
  { label: "Very High",            color: "#a51d14" },
  { label: "Relatively High",      color: "#e04a26" },
  { label: "Relatively Moderate",  color: "#f98a3c" },
  { label: "Relatively Low",       color: "#fdc666" },
  { label: "Very Low",             color: "#fff3c4" },
  { label: "Insufficient Data",    color: "#cfcfcf" },
  { label: "No Rating",            color: "#cfcfcf" },
];
const NO_DATA = "#d6d6d6";

const METRICS = {
  states: [
    { key: "eal_per_person",    label: "Expected annual loss per person", fmt: v => money(v), palette: SEQ },
    { key: "pct_pop_high_risk", label: "% of people in high-risk counties", fmt: v => `${v}%`, palette: SEQ },
    { key: "eal_total",         label: "Total expected annual loss", fmt: v => money(v), palette: SEQ },
  ],
  counties: [
    { key: "risk_rating",    label: "FEMA risk rating", categorical: true },
    { key: "risk_score",     label: "FEMA risk score (0-100)", fmt: v => v.toFixed(1), palette: SEQ },
    { key: "eal_per_person", label: "Expected annual loss per person", fmt: v => money(v), palette: SEQ },
    { key: "sovi_score",     label: "Social vulnerability (0-100)", fmt: v => v.toFixed(1), palette: SEQ },
    { key: "resl_score",     label: "Community resilience (0-100)", fmt: v => v.toFixed(1), palette: SEQ_GOOD },
  ],
};

// ------------------------------------------------------------------
// State
// ------------------------------------------------------------------
const app = {
  view: "states",
  metric: null,
  data: null,      // { states, counties } records keyed by FIPS
  shapes: null,    // { states, counties } GeoJSON
  layer: null,
  outline: null,   // state borders drawn on top of counties
  breaks: [],
  selected: null,
};

// ------------------------------------------------------------------
// Helpers
// ------------------------------------------------------------------
function money(v) {
  if (v == null) return "-";
  const a = Math.abs(v);
  if (a >= 1e9) return `$${(v / 1e9).toFixed(1)}B`;
  if (a >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `$${(v / 1e3).toFixed(1)}K`;
  return `$${Math.round(v).toLocaleString()}`;
}
const fmtInt = v => (v == null ? "-" : v.toLocaleString());

function recordFor(feature) {
  return app.data[app.view][String(feature.id)];
}

// 5 quantile classes so colors spread evenly across places
function quantileBreaks(values, n = 5) {
  const v = values.filter(x => x != null && !Number.isNaN(x)).sort((a, b) => a - b);
  if (!v.length) return [];
  const out = [];
  for (let i = 1; i < n; i++) out.push(v[Math.floor((i / n) * (v.length - 1))]);
  return out;
}

function colorFor(record) {
  const m = app.metric;
  if (!record) return NO_DATA;
  const v = record[m.key];
  if (m.categorical) return (RATINGS.find(r => r.label === v) || { color: NO_DATA }).color;
  if (v == null) return NO_DATA;
  let i = 0;
  while (i < app.breaks.length && v > app.breaks[i]) i++;
  return m.palette[i];
}

// ------------------------------------------------------------------
// Map
// ------------------------------------------------------------------
const map = L.map("map", { preferCanvas: true, zoomSnap: 0.25, minZoom: 3 })
  .fitBounds([[24.5, -125], [49.5, -66.5]]);

   L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}", {
     maxZoom: 16,
     attribution: "Tiles &copy; Esri &mdash; Esri, HERE, Garmin, &copy; OpenStreetMap contributors",
   }).addTo(map);

function baseStyle(feature) {
  const isSelected = app.selected && String(feature.id) === app.selected;
  return {
    fillColor: colorFor(recordFor(feature)),
    fillOpacity: 0.85,
    color: isSelected ? "#1d232b" : "#ffffff",
    weight: isSelected ? 2.5 : app.view === "states" ? 1 : 0.3,
  };
}

function tooltipHtml(feature) {
  const r = recordFor(feature);
  const m = app.metric;
  if (!r) return `<b>${feature.properties.name}</b><br>No FEMA data for this area`;
  const name = app.view === "counties" ? `${r.name}, ${r.state}` : r.name;
  const v = r[m.key];
  const shown = v == null ? "No data" : m.categorical ? v : m.fmt(v);
  return `<b>${name}</b><br>${m.label}: ${shown}`;
}

function draw() {
  if (app.layer) app.layer.remove();
  if (app.outline) app.outline.remove();

  // Breaks come only from places actually drawn (territories off the map are left out)
  const records = app.shapes[app.view].features.map(recordFor).filter(Boolean);
  app.breaks = app.metric.categorical ? [] : quantileBreaks(records.map(r => r[app.metric.key]));

  app.layer = L.geoJSON(app.shapes[app.view], {
    style: baseStyle,
    onEachFeature: (feature, layer) => {
      layer.bindTooltip(() => tooltipHtml(feature), { sticky: true, className: "risk-tip" });
      layer.on({
        mouseover: e => e.target.setStyle({ weight: app.view === "states" ? 2.5 : 1.5, color: "#1d232b" }),
        mouseout: e => app.layer.resetStyle(e.target),
        click: e => select(feature, e.target),
      });
    },
  }).addTo(map);

  // In county view, keep state borders visible for orientation
  if (app.view === "counties") {
    app.outline = L.geoJSON(app.shapes.states, {
      style: { fill: false, color: "#ffffff", weight: 1.2 },
      interactive: false,
    }).addTo(map);
  }

  renderLegend();
}

// ------------------------------------------------------------------
// Legend
// ------------------------------------------------------------------
const legend = L.control({ position: "bottomleft" });
legend.onAdd = () => L.DomUtil.create("div", "legend");
legend.addTo(map);

function renderLegend() {
  const m = app.metric;
  const el = legend.getContainer();
  let rows;
  if (m.categorical) {
    rows = RATINGS.filter(r => r.label !== "No Rating").map(r => [r.color, r.label]);
  } else {
    const b = app.breaks;
    rows = m.palette.map((c, i) => {
      if (i === 0) return [c, `≤ ${m.fmt(b[0])}`];
      if (i === m.palette.length - 1) return [c, `> ${m.fmt(b[b.length - 1])}`];
      return [c, `${m.fmt(b[i - 1])} – ${m.fmt(b[i])}`];
    }).reverse();
  }
  rows.push([NO_DATA, "No data"]);
  el.innerHTML = `<div class="title">${m.label}</div>` +
    rows.map(([c, t]) => `<div class="item"><i style="background:${c}"></i>${t}</div>`).join("");
}

// ------------------------------------------------------------------
// Details panel
// ------------------------------------------------------------------
function select(feature, layer) {
  app.selected = String(feature.id);
  app.layer.setStyle(baseStyle);
  map.fitBounds(layer.getBounds(), { maxZoom: app.view === "states" ? 6 : 8, padding: [20, 20] });
  renderPanel(feature);
}

function stat(label, value) {
  return `<div class="stat"><div class="label">${label}</div><div class="value">${value}</div></div>`;
}

function hazardList(list) {
  if (!list || !list.length) return "<p class='hint'>No hazard losses reported.</p>";
  const max = list[0].eal;
  return `<ul class="hazards">${list.map(h => `
    <li>
      <div class="row"><span>${h.hazard}</span><span>${money(h.eal)}/yr</span></div>
      <div class="bar"><span style="width:${(100 * h.eal / max).toFixed(0)}%"></span></div>
    </li>`).join("")}</ul>`;
}

function renderPanel(feature) {
  const r = recordFor(feature);
  const body = document.getElementById("panel-body");

  if (!r) {
    body.innerHTML = `<h2>${feature.properties.name}</h2>
      <p class="sub">No FEMA data matched this area.</p>
      <p class="note">The boundary file uses older county lines in a few places
      (Connecticut's 2022 switch to planning regions, for example), so those
      areas don't line up with FEMA's latest data yet.</p>`;
    return;
  }

  if (app.view === "states") {
    body.innerHTML = `
      <h2>${r.name}</h2>
      <p class="sub">${r.counties} counties · ${fmtInt(r.population)} people</p>
      <div class="stats">
        ${stat("Loss per person / yr", money(r.eal_per_person))}
        ${stat("Total loss / yr", money(r.eal_total))}
        ${stat("People in high-risk counties", `${r.pct_pop_high_risk}%`)}
        ${stat("High-risk counties", r.high_risk_counties)}
      </div>
      <h3>Biggest hazards (expected annual loss)</h3>
      ${hazardList(r.top_hazards)}
      <p class="note">"High-risk" means FEMA rated the county Relatively High or Very High.</p>`;
  } else {
    const rating = RATINGS.find(x => x.label === r.risk_rating) || { color: NO_DATA };
    const dark = ["Very High", "Relatively High"].includes(r.risk_rating);
    body.innerHTML = `
      <h2>${r.name}</h2>
      <p class="sub">${r.state} · ${fmtInt(r.population)} people</p>
      <span class="badge" style="background:${rating.color};color:${dark ? "#fff" : "#1d232b"}">
        ${r.risk_rating} risk</span>
      <div class="stats">
        ${stat("Risk score", r.risk_score == null ? "-" : r.risk_score.toFixed(1))}
        ${stat("Loss per person / yr", money(r.eal_per_person))}
        ${stat("Social vulnerability", r.sovi_score == null ? "-" : r.sovi_score.toFixed(1))}
        ${stat("Community resilience", r.resl_score == null ? "-" : r.resl_score.toFixed(1))}
      </div>
      <h3>Biggest hazards (expected annual loss)</h3>
      ${hazardList(r.top_hazards)}
      <p class="note">Scores are national percentiles from 0 to 100. Higher risk and vulnerability
      are worse; higher resilience is better.</p>`;
  }
}

function resetPanel() {
  app.selected = null;
  document.getElementById("panel-body").innerHTML =
    `<p class="hint">Click a ${app.view === "states" ? "state" : "county"} to see its details.</p>`;
}

// ------------------------------------------------------------------
// Controls
// ------------------------------------------------------------------
const metricSelect = document.getElementById("metric");

function fillMetricOptions() {
  metricSelect.innerHTML = METRICS[app.view]
    .map((m, i) => `<option value="${i}">${m.label}</option>`).join("");
  app.metric = METRICS[app.view][0];
}

metricSelect.addEventListener("change", () => {
  app.metric = METRICS[app.view][Number(metricSelect.value)];
  draw();
});

document.querySelectorAll(".toggle button").forEach(btn => {
  btn.addEventListener("click", () => {
    if (btn.dataset.view === app.view) return;
    document.querySelectorAll(".toggle button").forEach(b => b.classList.toggle("active", b === btn));
    app.view = btn.dataset.view;
    fillMetricOptions();
    resetPanel();
    draw();
  });
});

// ------------------------------------------------------------------
// Start
// ------------------------------------------------------------------
(async function init() {
  const loading = document.getElementById("loading");
  try {
    const [data, shapes] = await Promise.all([loadRiskData(), loadBoundaries()]);
    app.data = data;
    app.shapes = shapes;
    document.getElementById("source").innerHTML =
      `Data: <a href="https://hazards.fema.gov/nri/" target="_blank" rel="noopener">${data.source}</a>, ${data.version}`;
    fillMetricOptions();
    draw();
    loading.classList.add("hidden");
  } catch (err) {
    console.error(err);
    loading.textContent = `Couldn't load the map: ${err.message}`;
    loading.classList.add("error");
  }
})();

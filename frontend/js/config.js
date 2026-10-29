// App settings. This is the file to edit when the backend is ready.
window.APP_CONFIG = {
  // null  -> use the static file data/risk-data.js (works offline / on Vercel today)
  // "https://your-api.example.com" -> fetch from the FastAPI backend instead
  //   expected endpoint: GET {API_BASE}/risk  -> same JSON shape as data/risk-data.js
  API_BASE: null,

  // State + county boundaries (lat/lon TopoJSON, ids are FIPS codes)
  BOUNDARIES_URL: "https://cdn.jsdelivr.net/npm/us-atlas@3.0.1/counties-10m.json",

  // 50 states + DC + Puerto Rico. Other territories aren't in the boundary file.
  STATE_FIPS_ON_MAP: [
    "01","02","04","05","06","08","09","10","11","12","13","15","16","17","18",
    "19","20","21","22","23","24","25","26","27","28","29","30","31","32","33",
    "34","35","36","37","38","39","40","41","42","44","45","46","47","48","49",
    "50","51","53","54","55","56","72"
  ],
};

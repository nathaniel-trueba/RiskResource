# Risk Resource – Frontend

Interactive US map of natural disaster risk, built with Leaflet and FEMA's
National Risk Index (NRI, December 2025 release).

## What it does

- **States / Counties toggle** at the top.
- **"Show" dropdown** to pick the metric:
  - States: expected annual loss per person, % of people in high-risk counties, total expected annual loss
  - Counties: FEMA risk rating, risk score, loss per person, social vulnerability, community resilience
- **Hover** for a quick readout. **Click** to zoom in and open the details panel, which shows key numbers and the top 3 hazards.
- Colors use 5 quantile classes, so each color covers about the same number of places.

## Run it locally

Use a simple local server. Some browsers block loading the files when you double-click `index.html`.

```bash
cd risk-resource-frontend
python -m http.server 8000
```

Then open http://localhost:8000.
In VS Code, the **Live Server** extension works too: right-click `index.html` and choose **Open with Live Server**.

## Deploy to Vercel

This is a static site, so it needs no build step.

1. Push this folder to GitHub.
2. In Vercel, go to **Add New → Project**, import the repo, set **Framework Preset: Other**, and leave the build command empty.
3. Deploy. Every push to `main` redeploys.

You can also deploy from a terminal with `npm i -g vercel`, then run `vercel` in this folder.

## Project layout

```
index.html            page structure
css/style.css         styling
js/config.js          settings: API_BASE, boundary file URL   <- edit this for the backend
js/data.js            loads risk data and boundaries
js/map.js             map, colors, legend, tooltips, details panel
data/risk-data.js     generated FEMA data (states + counties)
scripts/build_data.py regenerates data/risk-data.js from FEMA's CSV
```

## Updating the data

Download **All Counties → Table** from https://hazards.fema.gov/nri/data-resources, unzip it, then run:

```bash
pip install pandas
python scripts/build_data.py path/to/NRI_Table_Counties.csv path/to/NRI_HazardInfo.csv
```

## Hooking up the backend (FastAPI / Lambda)

The map gets all of its data through `loadRiskData()` in `js/data.js`. When the API is ready:

1. Have the backend serve `GET /risk`, returning the same JSON shape as `data/risk-data.js`:
   ```json
   { "source": "...", "version": "...",
     "states":   { "06":    { "name": "California", "eal_per_person": 764.81, ... } },
     "counties": { "06037": { "name": "Los Angeles County", "risk_score": 100.0, ... } } }
   ```
   Keys are FIPS codes: 2 digits for states, 5 digits for counties.
2. In `js/config.js`, set `API_BASE` to the API URL.
3. Enable CORS on the API for the Vercel domain. With FastAPI, use `CORSMiddleware`.

`scripts/build_data.py` already contains the processing logic, so the backend can reuse it.

## Known issues / next steps

- **Connecticut shows "no data" in county view.** FEMA now uses CT's 9 planning regions, but the
  boundary file (`us-atlas@3.0.1`) still has the old 8 counties. The fix is to switch to a newer
  Census boundary file. State view is unaffected.
- Ideas: a search box (go to a county or ZIP code), a hazard filter (for example, show only wildfire risk),
  and a "compare two places" view.

# Risk Resource

Natural disaster information is spread across many different agency websites and can be hard to access when they're needed. Risk Resource was built to help residents understand the natural disasters that could affect their home during any season and stay up-to-date with live monitoring and personalized steps to help stay prepared.

## What It Does

Risk Resource is planned as a website where a user enters a US address and sees:

- A risk score covering wildfire, flood, earthquake, and severe weather (whatever pertains to the location)
- A score for each hazard, with the factors driving it
- A map of the live data behind the score
- A plain-language explanation of the score
- Safety resources and recommended prevention for top hazards

The home page will display a map of current natural disasters across the US.

## Approach

Each hazard's sub-score will be built from two parts:

| Part | Based on | Examples |
|------|----------|----------|
| Baseline | Static, long-term data | FEMA National Risk Index, terrain, distance to faults and flood zones |
| Live | Real-time public feeds | Nearby active fires, river levels vs. flood stage, recent earthquakes, active weather alerts |

The composite score will be a weighted blend of the four sub-scores. Keeping the baseline and live parts separate is intended to make each score explainable.

The project will start with a rule-based score. The team will then train a machine learning model on historical data to estimate baseline risk, and will only use it if it performs better than the rules on held-out regions.

## Data

The team will build its own dataset by pulling from free public sources, including:

| Hazard / Category | Sources |
|-------------------|---------|
| Location & Boundaries | Open-Meteo Geocoding API, Plotly US Counties GeoJSON, US Census Population Estimates |
| Severe Weather & Hazards | National Weather Service (NWS) Active Alerts API |
| Weather Conditions & Wildfire | Open-Meteo Forecast API |
| Flood | NOAA National Water Prediction Service (NWPS) Gauges API, NWS Active Alerts |
| Earthquake | USGS Earthquake Catalog API |
| Historical Baseline | OpenFEMA Disaster Declarations Summaries API |

## Planned Tech Stack

| Area | Tools |
|------|-------|
| Data and geospatial | Python, pandas, GeoPandas, PostGIS or DuckDB spatial |
| Modeling | scikit-learn, XGBoost, SHAP |
| Cloud | AWS (S3, Lambda, API Gateway, EventBridge, SageMaker, CloudWatch) |
| Frontend | Next.js, React, a web mapping library (MapLibre GL or Leaflet), Vercel |
| Explanations | Claude API |

## Repository Structure

```text
RiskResource/
├── backend/
│   ├── app/
│   │   ├── clients/
│   │   │   ├── __init__.py
│   │   │   ├── nwps.py
│   │   │   ├── nws.py
│   │   │   ├── open_meteo.py
│   │   │   └── usgs.py
│   │   ├── core/
│   │   │   ├── __init__.py
│   │   │   └── cache.py
│   │   ├── domain/
│   │   │   ├── __init__.py
│   │   │   ├── geo.py
│   │   │   ├── hazards.py
│   │   │   └── scoring.py
│   │   ├── routers/
│   │   │   ├── __init__.py
│   │   │   ├── counties.py
│   │   │   ├── health.py
│   │   │   ├── map_values.py
│   │   │   ├── search.py
│   │   │   └── states.py
│   │   ├── services/
│   │   ├── __init__.py
│   │   ├── config.py
│   │   ├── dependencies.py
│   │   ├── main.py
│   │   └── schemas.py
│   ├── data/
│   │   └── reference.json
│   ├── scripts/
│   │   ├── __init__.py
│   │   └── build_reference_data.py
│   ├── env.example
│   └── requirements.txt
├── frontend/
│   ├── app/
│   │   ├── about/
│   │   │   └── page.tsx
│   │   ├── map/
│   │   │   └── page.tsx
│   │   ├── globals.css
│   │   ├── layout.tsx
│   │   └── page.tsx
│   ├── components/
│   │   ├── common/
│   │   │   ├── Footer.tsx
│   │   │   └── Navigation.tsx
│   │   ├── home/
│   │   │   ├── CtaBanner.tsx
│   │   │   ├── FeaturesGrid.tsx
│   │   │   ├── HazardMapShowcase.tsx
│   │   │   ├── HeroScoreCard.tsx
│   │   │   ├── HeroSection.tsx
│   │   │   ├── MiniMapPreview.tsx
│   │   │   └── StatsSection.tsx
│   │   └── map/
│   │       ├── CountyInspector.tsx
│   │       ├── MapControls.tsx
│   │       ├── MapLegend.tsx
│   │       ├── RiskLeafletMap.tsx
│   │       └── StateInspector.tsx
│   ├── lib/
│   │   ├── mockRiskData.ts
│   │   └── types.ts
│   ├── public/
│   ├── eslint.config.mjs
│   ├── next.config.ts
│   ├── package-lock.json
│   ├── package.json
│   └── tsconfig.json
├── model/
├── notebooks/
├── visuals/
├── .gitignore
├── LICENSE
└── README.md
```

## Disclaimer **

Risk Resource is intended for informational purposes only and is not a substitute for official warnings or evacuation orders.

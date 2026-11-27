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

The overall threat score is 40% historical baseline, 40% live signal and 20% a wildfire ignition model (see [`backend/README.md`](backend/README.md)), so it leans toward wildfire risk by design. Keeping the parts separate is intended to make each score explainable.

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
| Historical Baseline | OpenFEMA Disaster Declarations Summaries API, USGS Earthquake Catalog |
| Expected Annual Loss | FEMA National Risk Index (NRI), December 2025 release |

The full list, with exactly how each source is called, is in [claude-docs/apis.md](claude-docs/apis.md) and [claude-docs/apis-usage.md](claude-docs/apis-usage.md).

## Tech Stack

| Area | Tools |
|------|-------|
| Backend | Python, FastAPI, psycopg |
| Database | Postgres hosted on Supabase |
| Data sources | FEMA National Risk Index (ArcGIS), NWS alerts, USGS earthquakes, NOAA NWPS river gauges, Open-Meteo |
| Cloud | AWS Lambda, EventBridge, CloudWatch Logs |
| Frontend | Next.js, React, TypeScript, Tailwind CSS, Leaflet |

## Repository Structure

```text
RiskResource/
├── backend/                       FastAPI service (see backend/README.md)
│   ├── app/
│   │   ├── clients/               One client per upstream API
│   │   │   ├── nwps.py            NOAA NWPS river gauge list (large, slow nationwide call)
│   │   │   ├── nws.py             NWS active weather alerts
│   │   │   ├── open_meteo.py      Open-Meteo geocoding and current weather
│   │   │   └── usgs.py            USGS earthquake feed
│   │   ├── core/
│   │   │   └── cache.py           In-memory TTL cache
│   │   ├── domain/                Scoring rules and hazard tables, no I/O
│   │   │   ├── geo.py             Geography helpers
│   │   │   ├── hazards.py         Hazard definitions and NRI hazard-code mapping
│   │   │   └── scoring.py         Risk score calculation
│   │   ├── routers/               One module per endpoint group
│   │   │   ├── counties.py        County endpoints
│   │   │   ├── health.py          Health check endpoint
│   │   │   ├── map_values.py      Per-place values used to color the map
│   │   │   ├── search.py          County and state search endpoint
│   │   │   └── states.py          State endpoints
│   │   ├── services/
│   │   │   ├── reference.py       Loads reference data from the database
│   │   │   ├── risk.py            Builds state, county and map responses
│   │   │   ├── search.py          Search logic behind the search endpoint
│   │   │   └── snapshot.py        National scores from nationwide feeds
│   │   ├── config.py              Settings read from environment variables
│   │   ├── db.py                  Postgres connection, schema creation, seeding
│   │   ├── dependencies.py        Shared FastAPI dependencies
│   │   ├── main.py                FastAPI app setup and router registration
│   │   └── schemas.py             API response models
│   ├── aws/
│   │   └── lambda_function.py     Scheduled collector: fetches NWS, USGS, NOAA, Open-Meteo and FEMA NRI data and upserts it into Postgres
│   ├── data/
│   │   └── reference.json         Committed snapshot that seeds the database
│   ├── db/
│   │   └── schema.sql             Postgres tables, including api_config and the NRI tables
│   ├── scripts/
│   │   ├── build_reference_data.py  Rebuilds data/reference.json from FEMA NRI
│   │   └── init_db.py             Creates the schema and seeds the database
│   ├── env.example                Template for required environment variables
│   ├── README.md
│   └── requirements.txt
├── claude-docs/                   Detailed docs for developers and coding agents
│   ├── apis.md
│   ├── apis-usage.md
│   ├── backend-doc.md
│   ├── frontend-doc.md
│   └── human-review.md            Decisions and issues that need a human
├── frontend/                      Next.js site
│   ├── app/
│   │   ├── about/page.tsx         /about
│   │   ├── map/page.tsx           /map
│   │   ├── globals.css            Global styles
│   │   ├── layout.tsx             Root layout: page metadata and theme provider
│   │   └── page.tsx               / (hero, hazard map showcase, features grid)
│   ├── components/
│   │   ├── about/
│   │   │   └── ScoreExplainer.tsx   Explains how the risk score is built
│   │   ├── common/
│   │   │   ├── Footer.tsx         Site footer
│   │   │   ├── Navigation.tsx     Sticky top bar with page links and theme toggle
│   │   │   └── ThemeProvider.tsx  Light/dark theme context, saved in localStorage
│   │   ├── home/
│   │   │   ├── FeaturesGrid.tsx   "What you can do" feature cards
│   │   │   ├── HazardMapShowcase.tsx  US map that cycles through the five hazards
│   │   │   ├── HeroScoreCard.tsx  Sample score card with a county picker and hazard bars
│   │   │   └── HomeSearch.tsx     County and state search box on the home page
│   │   └── map/
│   │       ├── CountyInspector.tsx    Side panel for a selected county
│   │       ├── ExpectedLossSection.tsx  Expected annual loss breakdown
│   │       ├── MapControls.tsx    Geography, metric and hazard controls
│   │       ├── MapLegend.tsx      Color legend for the map
│   │       ├── RiskLeafletMap.tsx Leaflet map of states and counties
│   │       └── StateInspector.tsx Side panel for a selected state
│   ├── lib/
│   │   ├── api.ts                 Every backend call
│   │   ├── format.ts              Number and currency formatting helpers
│   │   ├── nri.ts                 FEMA NRI labels and helpers
│   │   ├── riskColors.ts          Color ramps for risk scores
│   │   └── types.ts               Mirrors backend/app/schemas.py
│   ├── eslint.config.mjs
│   ├── next.config.ts
│   ├── package-lock.json
│   ├── package.json
│   └── tsconfig.json
├── .gitignore
└── README.md
```

Empty `__init__.py` files are left out.

## Documentation

| Doc | For |
|---|---|
| [backend/README.md](backend/README.md) | Setting up and running the backend |
| [claude-docs/backend-doc.md](claude-docs/backend-doc.md) | The API, scoring model, database, caching and deployment, in detail |
| [claude-docs/frontend-doc.md](claude-docs/frontend-doc.md) | The frontend's structure, data flow and data contract |
| [claude-docs/apis.md](claude-docs/apis.md), [apis-usage.md](claude-docs/apis-usage.md) | External APIs and exactly how they're called |
| [claude-docs/human-review.md](claude-docs/human-review.md) | Decisions nobody has approved yet, and known issues, most important first |

## Backend Setup

See [backend/README.md](backend/README.md) for the backend's architecture and details.

The API reads its reference data (states, counties, baseline hazard scores) from a
Supabase Postgres database. Only the backend talks to Supabase.

1. Copy `backend/env.example` to `backend/.env` and set `DATABASE_URL` to the
   Supabase **session pooler** connection string, with the real database password.
2. Install dependencies: `pip install -r backend/requirements.txt`
3. Start the API (from `backend/`): `python -m uvicorn app.main:app --reload`. It runs
   at http://localhost:8000, with interactive docs at http://localhost:8000/docs.

On startup the API creates any missing tables from `backend/db/schema.sql` and,
if the reference data is empty, seeds it from the committed `data/reference.json`
snapshot. Both happen only once; later startups just read the data.

To replace data that's already seeded (from `backend/`):
- `python -m scripts.init_db --reseed` reloads it from `data/reference.json`
- `python -m scripts.init_db --refresh` rebuilds it from FEMA, USGS, Census and the NRI
  (about a minute), updates `data/reference.json`, then reseeds

Both write to the database the whole team shares.

## Frontend Setup

With the backend running, from `frontend/`:

```bash
npm ci
npm run dev        # http://localhost:3000
```

The site calls the backend at `NEXT_PUBLIC_API_URL`, which defaults to
`http://localhost:8000/api`. A deployed site needs it set to the deployed backend's URL
(plus `/api`) at build time; see
[claude-docs/backend-doc.md](claude-docs/backend-doc.md#deploying).

## Disclaimer **

Risk Resource is intended for informational purposes only and is not a substitute for official warnings or evacuation orders.

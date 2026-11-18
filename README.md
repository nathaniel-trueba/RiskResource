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
| Historical Baseline | OpenFEMA Disaster Declarations Summaries API, USGS Earthquake Catalog |
| Expected Annual Loss | FEMA National Risk Index (NRI), December 2025 release |

The full list, with exactly how each source is called, is in [claude-docs/apis.md](claude-docs/apis.md) and [claude-docs/apis-usage.md](claude-docs/apis-usage.md).

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
├── backend/                     FastAPI service (see backend/README.md)
│   ├── app/
│   │   ├── clients/             One client per upstream API
│   │   │   ├── nwps.py
│   │   │   ├── nws.py
│   │   │   ├── open_meteo.py
│   │   │   └── usgs.py
│   │   ├── core/
│   │   │   └── cache.py         In-memory TTL cache
│   │   ├── domain/              Scoring rules and hazard tables, no I/O
│   │   │   ├── geo.py
│   │   │   ├── hazards.py
│   │   │   └── scoring.py
│   │   ├── routers/             One module per endpoint group
│   │   │   ├── counties.py
│   │   │   ├── health.py
│   │   │   ├── map_values.py
│   │   │   ├── search.py
│   │   │   └── states.py
│   │   ├── services/
│   │   │   ├── reference.py     Loads reference data from the database
│   │   │   ├── risk.py          Builds state, county and map responses
│   │   │   ├── search.py
│   │   │   └── snapshot.py      National scores from nationwide feeds
│   │   ├── config.py
│   │   ├── db.py                Postgres connection, schema creation, seeding
│   │   ├── dependencies.py
│   │   ├── main.py
│   │   └── schemas.py           API response models
│   ├── data/
│   │   └── reference.json       Committed snapshot that seeds the database
│   ├── db/
│   │   └── schema.sql
│   ├── scripts/
│   │   ├── build_reference_data.py
│   │   └── init_db.py
│   ├── env.example
│   ├── README.md
│   └── requirements.txt
├── claude-docs/                 Detailed docs for developers and coding agents
│   ├── apis.md
│   ├── apis-usage.md
│   ├── backend-doc.md
│   ├── frontend-doc.md
│   └── human-review.md          Decisions and issues that need a human
├── frontend/                    Next.js site
│   ├── app/
│   │   ├── about/page.tsx       /about
│   │   ├── map/page.tsx         /map
│   │   ├── globals.css
│   │   ├── layout.tsx
│   │   └── page.tsx             /
│   ├── components/
│   │   ├── about/
│   │   │   └── ScoreExplainer.tsx
│   │   ├── common/
│   │   │   ├── Footer.tsx
│   │   │   └── Navigation.tsx
│   │   ├── home/
│   │   │   ├── FeaturesGrid.tsx
│   │   │   ├── HazardMapShowcase.tsx
│   │   │   ├── HeroScoreCard.tsx
│   │   │   └── HomeSearch.tsx
│   │   └── map/
│   │       ├── CountyInspector.tsx
│   │       ├── ExpectedLossSection.tsx
│   │       ├── MapControls.tsx
│   │       ├── MapLegend.tsx
│   │       ├── RiskLeafletMap.tsx
│   │       └── StateInspector.tsx
│   ├── lib/
│   │   ├── api.ts               Every backend call
│   │   ├── format.ts
│   │   ├── nri.ts
│   │   ├── riskColors.ts
│   │   └── types.ts             Mirrors backend/app/schemas.py
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

## Git and GitHub Workflow for DS3 Projects

Using Git and GitHub well is just as important as writing good code. A clean workflow makes collaboration easier and helps the project stay organized.

### 1. Use branches to separate work

Each person or feature should usually work in its own branch. This prevents people from overwriting each other's changes.

Common branch commands:

```bash
git branch
git checkout -b feature/my-task
git checkout main
git branch -d feature/my-task
```

What they mean:

- `git branch` shows existing branches
- `git checkout -b feature/my-task` creates and switches to a new branch
- `git checkout main` switches back to the main branch
- `git branch -d feature/my-task` deletes a branch after it is merged

### 2. Use pull requests to merge code into main

When work is complete, open a Pull Request (PR) from your branch into `main`. A PR is the place to review changes, discuss issues, and confirm everything is ready.

Important rule:

- Only project managers or mentors should approve pull requests.
- Students should contribute code, but approvals should be handled by the designated maintainers.

### 3. Basic Git commands and what they mean

```bash
git clone <repo-url>
git status
git add <file>
git add .
git commit -m "Describe your change"
git push origin <branch-name>
git log
git merge <branch-name>
git rebase <branch-name>
```

What they mean:

- `git clone` copies a repository from GitHub to your local machine
- `git status` shows which files changed and what branch you are on
- `git add` stages files for commit
- `git commit` saves staged changes with a message
- `git push` uploads your local commits to GitHub
- `git log` shows recent commit history
- `git merge` combines another branch into your current branch
- `git rebase` reapplies your commits on top of another branch and can help keep history cleaner

### 4. Recommended team habits

- Pull the latest changes before starting work
- Keep commits small and descriptive
- Avoid committing large data files or secrets
- Open a PR early for feedback, not only at the end
- Resolve merge conflicts carefully and communicate with the team

### 5. Example workflow

```bash
git checkout main
git pull origin main
git checkout -b feature/data-cleaning
git status
git add .
git commit -m "Add initial data cleaning script"
git push origin feature/data-cleaning
```

Then open a Pull Request on GitHub and wait for approval from the appropriate project manager or mentor.

## Notes for DS3 Projects

This template is intentionally simple so students can focus on the science instead of setup. As projects grow, teams can add:

- experiment tracking
- model checkpoints
- deployment scripts
- cloud infrastructure (AWS/GCP) in `infra/`
- frontend UI/UX code in `frontend/`
- CI checks
- docs pages

## Disclaimer **

Risk Resource is intended for informational purposes only and is not a substitute for official warnings or evacuation orders.

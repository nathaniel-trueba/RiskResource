# Risk Resource Backend

A FastAPI service that scores US states and counties for six natural hazards (wildfire,
earthquake, flood, severe storm, hurricane, tornado) and serves those scores to the
Next.js frontend.

Each score blends two halves, 50/50:

- **Baseline:** how often a hazard has hit a place historically (FEMA disaster
  declarations and USGS earthquakes since 2006). This is precomputed and stored in
  Supabase Postgres.
- **Live signal:** what's happening now (NWS alerts, recent USGS quakes, Open-Meteo
  forecasts, NOAA river gauges). It's fetched on demand and cached in memory.

Separately from the score, the API serves **expected annual loss** in dollars from
FEMA's National Risk Index (NRI). It's static, stored with the reference data, and
isn't part of the score. See [Expected annual loss](#expected-annual-loss-fema-nri).

## Getting started

Requires Python 3.11 or newer (developed on 3.14). Run everything from `backend/`.

```bash
python -m venv .venv
.venv\Scripts\activate          # Windows. On macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
```

Copy `env.example` to `.env` and set `DATABASE_URL`:

1. In the Supabase dashboard, open **Connect** and copy the **Session pooler**
   connection string. Use the session pooler rather than the direct connection, which
   is IPv6 only and fails on many networks.
2. Replace `[YOUR-PASSWORD]` with the database password. URL-encode special characters
   (`@` becomes `%40`).

`.env` is git-ignored. Never commit it. No Supabase API keys are needed, because only
the backend talks to the database. The other settings in `env.example` are optional.

Start the API:

```bash
python -m uvicorn app.main:app --reload
```

Use `python -m uvicorn` rather than `uvicorn`: on Windows, Smart App Control can block
the `uvicorn.exe` launcher that pip installs.

On the first start against an empty database, the API creates the tables and seeds
them from `data/reference.json`, which takes a few seconds. Later starts only check
that this was done. Interactive API docs are at http://localhost:8000/docs.

### Deploying

Run it as a long-running web service (for example on Render), not as serverless
functions: it loads data at startup and caches live feeds in memory. Start command:
`uvicorn app.main:app --host 0.0.0.0 --port $PORT`, from `backend/`. Set
`DATABASE_URL`, and `CORS_ORIGINS` to a JSON list with the site's address, e.g.
`["https://<site>.vercel.app"]`. Then set `NEXT_PUBLIC_API_URL` on the frontend to the
backend's URL plus `/api`, and redeploy the frontend. Details and troubleshooting are in
[`claude-docs/backend-doc.md`](../claude-docs/backend-doc.md#deploying).

### Database commands

You only need these to change data that's already seeded:

| Command | What it does |
|---|---|
| `python -m scripts.init_db` | Creates missing tables and seeds if empty. Startup does the same. |
| `python -m scripts.init_db --reseed` | Replaces the reference data from `data/reference.json` |
| `python -m scripts.init_db --refresh` | Rebuilds the data from FEMA, USGS, Census and the NRI (under a minute), saves it to `data/reference.json`, then reseeds |

## Architecture

```
HTTP request
   │
   ▼
routers/         Thin FastAPI endpoints: validate input, call a service, return a schema
   │
   ▼
services/        Assemble responses: combine reference data, live signals and scoring
   │   ├── uses ─▶ domain/    Pure scoring rules and hazard tables (no I/O)
   │   └── uses ─▶ core/cache.py ─▶ clients/ ─▶ upstream APIs (NWS, USGS, NWPS, Open-Meteo)
   ▼
schemas.py       Pydantic response models (camelCase JSON, mirrors frontend/lib/types.ts)
```

Dependencies only point downward. `domain/` imports nothing from the rest of the app,
and `clients/` only parses upstream responses. Neither knows about HTTP routes or
scoring decisions.

### Directory layout

```
backend/
├── app/
│   ├── main.py            App factory and startup (lifespan): DB init, services, cache warm-up
│   ├── config.py          Settings from environment variables / .env (pydantic-settings)
│   ├── db.py              Postgres connection, schema creation and reference data seeding
│   ├── dependencies.py    FastAPI Depends helpers that return the startup-created services
│   ├── schemas.py         API response models
│   ├── routers/           One module per endpoint group (health, states, counties, ...)
│   ├── services/
│   │   ├── reference.py   Loads static county/state data from the DB into memory
│   │   ├── snapshot.py    National scores for every county and state, from nationwide feeds
│   │   ├── risk.py        Builds state, county and map responses
│   │   └── search.py      Resolves county names, cities and ZIP codes to counties
│   ├── domain/
│   │   ├── hazards.py     Hazard enum, plus FEMA and NWS mappings onto hazards
│   │   ├── scoring.py     Every scoring rule and threshold
│   │   └── geo.py         Point-to-bounding-box distance
│   ├── clients/           One async client per upstream API
│   └── core/cache.py      In-memory TTL cache that serves recent data during outages
├── db/schema.sql          The whole database schema (safe to re-run)
├── data/reference.json    Committed snapshot of the reference data, used to seed the DB
├── ml/wildfire/           XGBoost weekly wildfire ignition model (see its README.md).
│                          Extra packages: requirements-ml.txt. Not wired into the API yet.
└── scripts/
    ├── init_db.py             CLI: initialize, reseed or refresh the database
    └── build_reference_data.py  Computes the reference data from FEMA, USGS and Census
```

### Startup

`main.lifespan` runs once when the server starts:

1. `db.initialize` creates any tables missing from `db/schema.sql`, and seeds the
   reference data from `data/reference.json` if it's empty.
2. `ReferenceData.from_database` reads about 46k small rows into memory, including the
   NRI loss tables. Requests never query the database.
3. The shared HTTP client, the TTL cache, the upstream clients and the two services are
   created and stored on `app.state`. Routes get them through `dependencies.py`.
4. A background task builds the first national snapshot, so the first visitor doesn't
   have to wait for it.

### How a score is computed

- **Map and state scores** come from the national snapshot (`services/snapshot.py`).
  NWS alerts and USGS quakes each take one API call for the whole country, so every
  county gets a live signal from them. Each county hazard score is
  `0.5 × baseline + 0.5 × strongest live signal`. State scores are population-weighted
  averages of their counties.
- **County detail** (`RiskService.get_county`) also adds two per-county sources: the
  Open-Meteo forecast (wildfire weather, wind) and NWPS river gauges (flood). That's
  why a county's detail score can be higher than its map value.
- **Composite scores** are 60% the worst hazard plus 40% the mean of the top three
  (`domain/scoring.composite_score`).
- **Tiers** are Low (0 to 29), Moderate (30 to 49), Elevated (50 to 74) and Critical
  (75 to 100).

All thresholds live in `domain/scoring.py` and `domain/hazards.py`. The frontend's
`/about` page is meant to describe this model, so update it when you change a rule.
Parts of it are currently out of date, including its score slider
(`components/about/ScoreExplainer.tsx`), which shows a different formula. See
[`claude-docs/human-review.md`](../claude-docs/human-review.md).

### Upstream failures

Every upstream call goes through `TTLCache.get_or_fetch`. Fresh data is served from
memory, and concurrent requests share a single fetch. If a call fails, the cache serves
the last good value for up to `MAX_STALE_SECONDS` (one hour) and waits
`FAILURE_COOLDOWN_SECONDS` before retrying. After that, the source counts as unavailable:
its hazards fall back to the baseline alone, and the response text says
"(live data unavailable)". `GET /api/health` reports each source's status.

## Database

Supabase Postgres, accessed only by the backend as the `postgres` role. Every table has
Row Level Security enabled with no policies, so Supabase's public Data API can't read
it.

| Table | Contents |
|---|---|
| `hazards` | The six hazard codes and labels |
| `states` | 50 states, DC and Puerto Rico |
| `counties` | 3,221 counties: name, centroid, bounding box, population |
| `county_hazard_baselines` | Per county and hazard: historical event count and baseline percentile (0 to 100) |
| `state_hazard_declarations` | Per state and hazard: distinct FEMA declarations |
| `reference_meta` | One row: when and how the baseline was built |
| `nri_meta` | One row: NRI version and the high-loss threshold |
| `nri_county_profiles`, `nri_county_losses` | Per county: NRI population, social vulnerability and community resilience ratings, loss-per-person percentile, and expected annual loss per hazard |
| `nri_state_profiles`, `nri_state_losses` | Per state: population, residents in high-loss counties, and expected annual loss per hazard |
| `api_config`, `locations`, `weather_observations`, `earthquakes`, `weather_alerts`, `gauges` | Tables for storing live upstream data. Not used yet: live data is cached in memory |

The reference data counts as seeded only when every reference table has rows, so a
database seeded before a table existed is reseeded on the next startup.

To change the schema, edit `db/schema.sql`. New tables are created on the next startup.
Changing an existing table isn't automatic: run an `ALTER TABLE` in the Supabase SQL
editor, and update `schema.sql` to match.

## Expected annual loss (FEMA NRI)

`scripts/build_reference_data.load_nri` pages through FEMA's official
[National Risk Index Counties](https://www.arcgis.com/home/item.html?id=39485e8035d446a5bff03259508ae355)
ArcGIS feature service. OpenFEMA's API doesn't serve the NRI, so this is the closest
thing to an API. We use the December 2025 release.

- **Hazards:** NRI models 18 hazards. Only the 11 that match ours count, mapped in
  `NRI_HAZARDS` in `domain/hazards.py`. Flood is inland plus coastal flooding. Severe
  Storm is strong wind, hail, lightning, ice storm and winter weather. The other 7
  (`NRI_EXCLUDED_HAZARDS`) are left out of every figure. Nationally, the counted
  hazards are about 86% of NRI's total expected loss.
- **What a loss is:** NRI's `*_EALT` fields, in dollars per year. They cover buildings,
  agriculture, and deaths and injuries at FEMA's dollar value. They're modeled
  estimates.
- **Per person:** total ÷ NRI's population, which is what NRI's estimates use.
- **High-loss counties:** a county is high-loss when its loss per person is at or above
  the 80th percentile of all NRI counties (`HIGH_LOSS_PERCENTILE`). A state's
  `highLossPct` is the share of its residents living in high-loss counties.
- **County codes:** NRI uses current codes, mapped onto our older ones by
  `NRI_TO_OUR_FIPS`. Valdez-Cordova, Alaska, adds its two successors together.
  Connecticut has no county-level data, because NRI reports it by planning region.
  State totals use every NRI row in the state, so Connecticut's total is complete.
  Bedford city, Virginia (merged in 2013) has no data either.

## Endpoints

All endpoints are under `/api`, and all are `GET`.

| Path | Returns |
|---|---|
| `/health` | Service status and each upstream source's cache state |
| `/map-values?level=state\|county&metric=...&hazard=...` | One value per area, for colouring the map. `metric` is `compositeScore`, a hazard (its score), `lossPerPerson`, `totalLoss` or `highLossPct` (states only). `hazard` limits `lossPerPerson` and `totalLoss` to one hazard. Scores include a `tier` |
| `/states/{code}` | State detail: scores, hazards, alerts, and `expectedLoss` |
| `/counties/{fips}` | County detail, including forecast and river gauge signals, and `expectedLoss` (omitted without NRI data) |
| `/search?q=...&limit=10` | Counties matching a county name, city or ZIP code |

Response shapes are defined in `app/schemas.py` and mirror `frontend/lib/types.ts`. If
you change one, change the other.

## Common changes

- **Change which alerts count toward a hazard, or their scores:** edit `ALERT_RULES`
  in `domain/hazards.py`.
- **Change which FEMA incident types count toward a baseline:** edit
  `FEMA_INCIDENT_HAZARDS` in `domain/hazards.py`, then run
  `python -m scripts.init_db --refresh`.
- **Change a threshold or weight:** edit `domain/scoring.py`.
- **Add an endpoint:** add a router module in `routers/`, put its logic in a service,
  add its response model to `schemas.py`, and register it in `main.create_app`.
- **Add an upstream source:** add a client in `clients/` that returns small frozen
  dataclasses, and call it through the cache from a service (see
  `RiskService._optional`).

Every function has a docstring covering what it does, its inputs and outputs, and what
calls it.

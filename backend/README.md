# Risk Resource Backend

A FastAPI service that scores US states and counties for six natural hazards (wildfire,
earthquake, flood, severe storm, hurricane, tornado) and serves those scores to the
Next.js frontend. It runs on Railway; the full design is in
[`docs/backend-doc.md`](../docs/backend-doc.md).

The overall threat score is **40% historical, 40% live and 20% wildfire model**:

- **Historical baseline:** how often a hazard has hit a place historically (FEMA disaster
  declarations and USGS earthquakes since 2006). This is precomputed, stored in
  Supabase Postgres, and rebuilt automatically once it's 30 days old.
- **Live signal:** what's happening now (NWS alerts, recent USGS quakes, Open-Meteo
  forecasts, NOAA river gauges). It's fetched on demand and cached in memory.
- **Wildfire model:** this week's chance of a large wildfire starting in the county, from
  the XGBoost model in [`ml/wildfire/`](ml/wildfire/README.md). Every Monday an AWS Step
  Functions pipeline (`aws/`) publishes it to `s3://riskresource-data-bucket/wildfire/latest.json`,
  and the API reads it from `WILDFIRE_MODEL_URI`, so the API itself doesn't need the ML
  dependencies. The two sides share only [`weekly_scores/`](weekly_scores/__init__.py).
  See [`docs/wildfire-model.md`](../docs/wildfire-model.md).

Historical and live are blended inside each hazard score (50/50, their 40:40 ratio).
The model is added to the overall score only, which gives the overall score a
wildfire bias by design. If the model file is missing or stale, the overall score
uses the hazards alone.

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

### Local settings

Add `REFERENCE_MAX_AGE_DAYS=0` to your `.env`. Otherwise your local API will rebuild the
reference data in the database the whole team shares once it's 30 days old; the
deployed API already does that. Leave `WILDFIRE_MODEL_URI` unset to read a local
`data/wildfire_model.json` (from `python -m ml.wildfire.predict_week`), or point it at
the S3 file if you have AWS credentials. Without either, the overall score uses the
hazards alone.

### Deploying

It's deployed on Railway as a long-running web service, which redeploys automatically on every
push to `main`. It isn't run as serverless functions, because
it loads data at startup, refreshes it on a timer, and caches live feeds in memory.
Start command: `uvicorn app.main:app --host 0.0.0.0 --port $PORT`, from `backend/`.
Set `DATABASE_URL`, `CORS_ORIGINS` (a JSON list with the Vercel site's address),
`WILDFIRE_MODEL_URI`, and the access key of the IAM user with read-only access to the
bucket's `wildfire/` prefix. The frontend's
`NEXT_PUBLIC_API_URL` must be this service's URL plus `/api`. Details and
troubleshooting are in [`docs/backend-doc.md`](../docs/backend-doc.md#deploying).

### Database commands

You only need these to change data that's already seeded:

| Command | What it does |
|---|---|
| `python -m scripts.init_db` | Creates missing tables and seeds if empty. Startup does the same. |
| `python -m scripts.init_db --reseed` | Replaces the reference data from `data/reference.json` |
| `python -m scripts.init_db --refresh` | Rebuilds the data from FEMA, USGS, Census and the NRI (under a minute), saves it to `data/reference.json`, then reseeds |

The deployed API runs the same rebuild by itself once the stored data is 30 days old
(`services/reference_refresh.py`), without rewriting `data/reference.json`.
`GET /api/health` shows when the data was built and when the next rebuild is due.

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
│   ├── main.py            App factory and startup (lifespan): DB init, services, background tasks
│   ├── config.py          Settings from environment variables / .env (pydantic-settings)
│   ├── db.py              Postgres connection, schema creation and reference data seeding
│   ├── dependencies.py    FastAPI Depends helpers that return the startup-created services
│   ├── schemas.py         API response models
│   ├── routers/           One module per endpoint group (health, states, counties, map-values, search, home-snapshot)
│   ├── services/
│   │   ├── reference.py          Loads static county/state data from the DB into memory
│   │   ├── reference_refresh.py  Rebuilds the reference data once it's 30 days old
│   │   ├── snapshot.py           National scores for every county and state, from nationwide feeds
│   │   ├── risk.py               Builds state, county and map responses
│   │   ├── search.py             Resolves county names, cities and ZIP codes to counties
│   │   ├── wildfire_model.py     Reads the weekly wildfire scores file
│   │   ├── alert_archive.py      Reads the Lambda's NWS alert archive during NWS outages
│   │   └── home_snapshot.py      Fixed state scores for the home page animation
│   ├── domain/
│   │   ├── hazards.py     Hazard enum, plus FEMA, NWS and NRI mappings onto hazards
│   │   ├── scoring.py     Every scoring rule and threshold
│   │   └── geo.py         Point-to-bounding-box distance
│   ├── clients/           One async client per upstream API
│   └── core/cache.py      In-memory TTL cache that serves recent data during outages
├── aws/                   NWS alert archive Lambda, and the weekly wildfire pipeline (Lambdas, Dockerfile, Step Functions)
├── db/schema.sql          The whole database schema (safe to re-run)
├── db/migrations/         One-off SQL for databases created before a schema change
├── data/reference.json    Committed snapshot of the reference data, used to seed an empty DB
├── data/snapshot/         Fixed scores for the home page animation
├── ml/wildfire/           XGBoost weekly wildfire ignition model (see its README.md).
│                          Extra packages: requirements-ml.txt
├── weekly_scores/         The wildfire scores file format, shared by the model and the API
└── scripts/
    ├── init_db.py             CLI: initialize, reseed or refresh the database
    └── build_reference_data.py  Computes the reference data from FEMA, USGS, Census and the NRI
```

### Startup

`main.lifespan` runs once when the server starts:

1. `db.initialize` creates any tables missing from `db/schema.sql`, and seeds the
   reference data from `data/reference.json` if it's empty.
2. `ReferenceData.from_database` reads about 46k small rows into memory, including the
   NRI loss tables. Requests never query the database.
3. The shared HTTP client, the TTL cache, the upstream clients and the two services are
   created and stored on `app.state`. Routes get them through `dependencies.py`.
4. Two background tasks start: one builds the first national snapshot, so the first
   visitor doesn't have to wait for it, and one checks the reference data's age every
   hour and rebuilds it when it's due.

### How a score is computed

- **Map and state scores** come from the national snapshot (`services/snapshot.py`).
  NWS alerts and USGS quakes each take one API call for the whole country, so every
  county gets a live signal from them. Each county hazard score is
  `0.5 × baseline + 0.5 × strongest live signal`. State scores are population-weighted
  averages of their counties.
- **County detail** (`RiskService.get_county`) also adds two per-county sources: the
  Open-Meteo forecast (wildfire weather, wind) and NWPS river gauges (flood). That's
  why a county's detail score can be higher than its map value.
- **Overall scores** (`compositeScore`) are 80% the hazard composite plus 20% the
  wildfire model score (`domain/scoring.overall_score`). The hazard composite is 60%
  the worst hazard plus 40% the mean of the top three (`domain/scoring.composite_score`).
  The model's weekly probability is scored on a log scale: 0.01% is 0, 1% is 67 and
  10% or more is 100 (`domain/scoring.wildfire_model_score`). States use the
  population-weighted model score of their counties.
- **Tiers** are Low (0 to 29), Moderate (30 to 49), Elevated (50 to 74) and Critical
  (75 to 100).

All thresholds live in `domain/scoring.py` and `domain/hazards.py`. The frontend's
`/about` page and its score slider (`components/about/ScoreExplainer.tsx`) describe this
model, and `frontend/lib/scoring.ts` and `frontend/lib/riskColors.ts` mirror the weights
and tier cutoffs, so update them when you change a rule.

### Upstream failures

Every upstream call goes through `TTLCache.get_or_fetch`. Fresh data is served from
memory, and concurrent requests share a single fetch. If a call fails, the cache serves
the last good value for up to `MAX_STALE_SECONDS` (one hour) and waits
`FAILURE_COOLDOWN_SECONDS` before retrying. After that, the source counts as unavailable:
its hazards fall back to the baseline alone, and the response text says
"(live data unavailable)". NWS has one more fallback: the alerts the AWS Lambda archived
in the last 90 minutes, labelled with their time. `GET /api/health` reports each
source's status.

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
| `nws_alert_archive`, `archive_settings`, `api_config` | The AWS Lambda's rolling one-year NWS alert archive, its settings, and its NWS request config. The API reads the archive only when NWS is unreachable (`services/alert_archive.py`) |

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
| `/health` | Service status, each upstream source's cache state, the wildfire model file, and the reference data's age |
| `/map-values?level=state\|county&metric=...&hazard=...` | One value per area, for colouring the map. `metric` is `compositeScore`, a hazard (its score), `lossPerPerson`, `totalLoss` or `highLossPct` (states only). `hazard` limits `lossPerPerson` and `totalLoss` to one hazard. Scores include a `tier` |
| `/states/{code}` | State detail: scores, hazards, alerts, and `expectedLoss` |
| `/counties/{fips}` | County detail, including forecast and river gauge signals, and `expectedLoss` (omitted without NRI data) |
| `/search?q=...&limit=10` | Counties matching a county name, city or ZIP code |
| `/home-snapshot` | Fixed state scores per hazard for the home page animation, from `data/snapshot/` |

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

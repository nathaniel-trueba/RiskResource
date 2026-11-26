# Risk Resource backend: design and how it works

Audience: developers and coding agents working on the backend or connecting the frontend to it.

Snapshot: 2026-11-18, matching `main` at `c25e614`, updated 2026-11-25 for the 40/40/20 overall score that adds the wildfire model ([section 5](#5-scoring-model)). If this doc and the code disagree, the code wins, and this doc should be updated.

Related docs:

- [`frontend-doc.md`](frontend-doc.md): the frontend and the data shapes it expects.
- [`apis-usage.md`](apis-usage.md): exactly what is called on each external API and how it's used.
- [`human-review.md`](human-review.md): decisions that still need human review, including the scoring rules.
- [`backend/README.md`](../backend/README.md): a shorter version of this doc for setting up the backend.

## 1. Summary

A FastAPI service that combines public hazard data into risk scores, and returns them in the shapes defined by [`frontend/lib/types.ts`](../frontend/lib/types.ts). It's built for a hackathon-style demo: there's no authentication and no automated tests.

Four things shape the design:

- **Two kinds of data.** Slow-changing reference data (counties, populations, hazard history and FEMA's expected losses) lives in a **Supabase Postgres database**. It's seeded once and read into memory at startup. Live data is fetched when needed and cached in memory.
- **Requests never touch the database.** The API reads about 45k small rows once at startup. Every request is served from memory, so database latency (the Supabase project is in US East) only affects startup.
- **Quotas are shared.** All site visitors share this backend's upstream limits, so everything is cached, and per-county APIs are only called when someone opens that county.
- **Upstream failures don't break the site.** If a source is down, the API still returns baseline scores and says that live data is unavailable. It never reports "no alerts" when it couldn't check.

Two separate things are served:

| | Risk score | Expected annual loss |
|---|---|---|
| What | A 0 to 100 score per hazard and overall | Dollars per year per hazard, from FEMA's National Risk Index (NRI) |
| Changes with live conditions | Yes: 40% live, plus the 20% wildfire model, which changes weekly | No, it's static |
| Source | FEMA declarations, USGS, NWS, Open-Meteo, NWPS, and the wildfire model ([`ml/wildfire/`](../backend/ml/wildfire/README.md)) | NRI, December 2025 release |

The loss figures aren't part of the score.

## 2. Running it

These commands are for PowerShell, from the repo root:

```powershell
cd backend
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
copy env.example .env          # then set DATABASE_URL, see below
python -m uvicorn app.main:app --reload --port 8000
```

- Interactive API docs: <http://localhost:8000/docs>
- Status of each source: <http://localhost:8000/api/health>

It was developed on Python 3.14 and needs at least 3.11. Run commands from `backend/`, or the `app` package won't be found.

Use `python -m uvicorn`, not `uvicorn`. On Windows, Smart App Control can block the unsigned `uvicorn.exe` launcher that pip installs ("An Application Control policy has blocked this file"). Running it through Python avoids that.

### Database connection

`DATABASE_URL` is the only required setting. To get it:

1. In the Supabase dashboard, open **Connect** and copy the **Session pooler** string (port 5432). Don't use the direct connection: on the free plan it's IPv6 only, and fails on many home and campus networks.
2. Replace `[YOUR-PASSWORD]` with the database password. URL-encode special characters (`@` becomes `%40`).

The backend connects as the `postgres` role and uses no Supabase API keys. If `DATABASE_URL` is missing or still has the placeholder, startup stops with a message saying so.

**`backend/.env` holds the database password.** It's git-ignored by the `.env` rule in the root `.gitignore`, which matches in any folder. Never commit it. Branches created before that `.gitignore` change don't ignore it.

### First start and seeding

There's no separate setup step. Every startup runs `db.initialize`, which:

1. Creates any table from [`db/schema.sql`](../backend/db/schema.sql) that's missing.
2. Seeds the reference data from the committed `data/reference.json` if **any** reference table is empty. A database seeded before a table existed is therefore reseeded automatically.
3. Does both in one transaction, under a Postgres advisory lock, so readers never see half-seeded tables and two processes starting at once don't both seed.

After the first start, each startup costs two quick checks.

| Command (from `backend/`) | What it does |
|---|---|
| `python -m scripts.init_db` | Same as startup: creates missing tables, seeds if empty |
| `python -m scripts.init_db --reseed` | Replaces the reference data from `data/reference.json` |
| `python -m scripts.init_db --refresh` | Rebuilds the data from FEMA, USGS, Census and the NRI (about 20 seconds), saves it to `data/reference.json`, then reseeds |

After a `--refresh`, commit the new `data/reference.json`, so a fresh database seeds with the same data.

### Configuration

All settings are defined in [`app/config.py`](../backend/app/config.py) and can be overridden in `backend/.env`. [`env.example`](../backend/env.example) lists them. It isn't named `.env.example` because the root `.gitignore` excludes `.env` files.

| Setting | Default | Purpose |
|---|---|---|
| `DATABASE_URL` | None, required | Supabase session pooler connection string |
| `USER_AGENT` | `UCSD-Risk-Resource-NotForProfit` | Sent on every upstream request |
| `CORS_ORIGINS` | `localhost:3000` and `127.0.0.1:3000` | Browser origins allowed to call the API |
| `UPSTREAM_TIMEOUT_SECONDS` | 15 | Per upstream request |
| `*_TTL_SECONDS` | See [section 7](#7-caching-and-failure-handling) | Cache lifetimes |
| `MAX_STALE_SECONDS`, `FAILURE_COOLDOWN_SECONDS` | 3600, 60 | Outage handling |
| `WILDFIRE_MODEL_URI` | `data/wildfire_model.json` (under `backend/`) | Where the weekly wildfire job publishes and the API reads: a path or `s3://bucket/key` ([section 5](#wildfire-model-0-to-100)) |
| `WILDFIRE_MODEL_MAX_AGE_DAYS` | 13 | Days after the file's `weekStart` that it's still used |

## 3. Structure

```
backend/
  README.md                      Setup and architecture, for new developers
  requirements.txt
  env.example
  db/schema.sql                  The whole database schema; safe to re-run
  data/reference.json            Snapshot that seeds the database; generated, committed, 2.0 MB
  data/wildfire_model.json       This week's wildfire model probabilities (the local default for WILDFIRE_MODEL_URI)
  weekly_scores/                 Stdlib-only hand-off between the weekly job and the API: document format and stores (file, S3)
  ml/wildfire/                   The wildfire model: training, artifacts, predict_week.py and the AWS handler.py (needs requirements-ml.txt)
  scripts/
    init_db.py                   CLI: initialize, reseed or refresh the database
    build_reference_data.py      Fetches FEMA, USGS, Census and NRI; computes the reference data
  app/
    main.py                      App factory; startup initializes the DB and creates services
    config.py                    Settings
    db.py                        Postgres connection, schema creation, seeding
    schemas.py                   Response models that mirror frontend/lib/types.ts
    dependencies.py              FastAPI dependencies
    routers/                     HTTP layer only, one file per endpoint group
    services/
      reference.py               Loads reference data from the DB into memory
      snapshot.py                National scores from the nationwide feeds and the wildfire model
      wildfire_model.py          Reads the weekly wildfire model file; re-reads it when it changes
      risk.py                    Builds StateRecord, CountyRecord and MapValue
      search.py                  Resolves text to counties
    clients/                     One file per external API; fetch and parse only
      nws.py, usgs.py, nwps.py, open_meteo.py
    domain/                      Pure rules with no I/O
      hazards.py                 Hazard list; alert, FEMA and NRI mapping tables
      scoring.py                 Every scoring formula and threshold
      geo.py                     Distance calculation
    core/
      cache.py                   TTL cache with stale fallback
```

Dependencies point one way: `routers` call `services`, which call `clients` and `domain`. Clients don't know about scoring, and `domain` doesn't know about HTTP.

**Every function has a docstring** with a summary, `Args`, `Returns` and a `Called by:` line. Keep that up when adding functions. Route handlers put their internal details after a `\f`, which FastAPI uses to keep them out of `/docs`.

### Startup

`main.lifespan` runs once:

1. `db.initialize` creates missing tables and seeds if needed ([section 2](#first-start-and-seeding)).
2. `ReferenceData.from_database` reads the reference tables into memory. If they're still empty, it raises `ReferenceNotSeededError`.
3. The HTTP client, TTL cache, upstream clients and the two services are created and stored on `app.state`. Routes get them through `dependencies.py`.
4. A background task builds the first national snapshot, so the first visitor doesn't wait.

### Request flow

```
GET /api/counties/06065
  routers/counties.py
    RiskService.get_county
      get_snapshot()          NWS alerts + USGS quakes + wildfire model, all counties (cached)
      _conditions_for()       Open-Meteo, this county (cached 30 min)
      _gauges_for()           NWPS, this county (cached 15 min)
      merge signals, score, write warnings
      _county_expected_loss() NRI losses, from memory
    returns CountyRecord
```

## 4. Endpoints

All are `GET`, under `/api`. JSON field names are camelCase.

| Endpoint | Returns | Errors |
|---|---|---|
| `/api/states/{code}` | `StateRecord`, with `expectedLoss`. The code is case-insensitive. Includes DC and PR | 404 unknown code |
| `/api/counties/{fips}` | `CountyRecord`, with `expectedLoss` unless NRI has no county data | 404 unknown FIPS, 422 not five digits |
| `/api/map-values?level=&metric=&hazard=` | `MapValue[]` | 400 unsupported combination, 422 invalid value |
| `/api/search?q=&limit=` | `SearchResult[]`. Empty when nothing matches | 422 missing `q` |
| `/api/health` | Status of each source | None |

### `/api/map-values` parameters

- `level`: `state` (default, 52 values) or `county` (3,221 values for scores, about 133 KB).
- `metric`:

| `metric` | Value | Tier | Levels |
|---|---|---|---|
| `compositeScore` (default) | Score, 0 to 100 | Yes | Both |
| `wildfire`, `earthquake`, `flood`, `severeStorm`, `hurricane`, `tornado` | That hazard's score | Yes | Both |
| `lossPerPerson` | NRI expected loss, $ per resident per year | No, `null` | Both |
| `totalLoss` | NRI expected loss, $ per year | No | Both |
| `highLossPct` | % of residents living in high-loss counties | No | States only |

- `hazard`: optional, for `lossPerPerson` and `totalLoss` only. It limits the loss to one hazard.

These return 400 with a `detail` message: `highLossPct` at county level, `highLossPct` with a hazard, or a hazard with a score metric. Loss metrics leave out areas without NRI data, which the frontend draws as "No data".

### `/api/search`

County names are matched locally. Anything else, such as a city or ZIP code, goes to a geocoder. A trailing state narrows results.

| Query | Result |
|---|---|
| `Riverside` | Riverside County, CA |
| `Palm Springs, CA` | Riverside County, CA, with `matchedPlace: "Palm Springs, California"` |
| `92262` | Riverside County, CA, with `matchedPlace` |
| `Washington` | Up to `limit` counties, largest first |

### Types

[`app/schemas.py`](../backend/app/schemas.py) mirrors [`frontend/lib/types.ts`](../frontend/lib/types.ts), which is reproduced in [section 4 of the frontend doc](frontend-doc.md#4-data-contract).

### Example: `/api/counties/06065` (shortened)

```json
{
  "name": "Riverside County",
  "state": "California",
  "stateCode": "CA",
  "compositeScore": 45,
  "tier": "Moderate",
  "fips": "06065",
  "pop": "2,458,395",
  "hazards": [
    { "name": "Wildfire", "score": 50, "tier": "Elevated", "warning": "..." }
  ],
  "wildfireModel": {
    "score": 38,
    "tier": "Moderate",
    "probability": 0.00142,
    "weekStart": "2026-11-23"
  },
  "expectedLoss": {
    "total": 2245807546.72,
    "perPerson": 929.23,
    "byHazard": [
      { "name": "Flood", "amount": 1127003661.31 },
      { "name": "Earthquake", "amount": 763784550.11 }
    ],
    "highLossThresholdPerPerson": 732.52,
    "highLossPercentile": 80,
    "source": "FEMA National Risk Index, December 2025",
    "lossPerPersonPercentile": 89,
    "isHighLoss": true,
    "socialVulnerability": "Relatively Low",
    "communityResilience": "Very Low"
  }
}
```

Scores, tiers and warnings depend on live conditions, so they vary. The Wildfire score here is its baseline of 100 halved, with no live signal. With a hazard composite of 47 and a model score of 38, `compositeScore` is 0.8 × 47 + 0.2 × 38 = 45 (the model numbers here are illustrative). `wildfireModel` is omitted when the model file is missing or stale; states have it too, population-weighted and without `probability`. `expectedLoss` is static. States have the same `expectedLoss` fields, minus the four county-only ones at the end, plus `highLossPopulationPct`.

### Rules the API follows

- Scores are whole numbers from 0 to 100. In `MapValue.value` they're sent as numbers like `23.0`.
- Populations in `pop` and `population` are preformatted strings. Unknown is `"N/A"`.
- Dollar amounts are raw numbers, in dollars per year. The frontend formats them.
- `hazards` is always present and sorted highest first. `expectedLoss.byHazard` is sorted largest first.
- `activeAlert` and `primaryAlert` are omitted when there are no alerts, and hold the "unavailable" text below during an NWS outage, when `activeAlertCount` is also omitted.
- Fields that are `None` in states and counties are omitted (`response_model_exclude_none`), for example `socialVulnerability` when NRI has no rating.
- County names include their suffix (`"Orleans Parish"`), and `state` is the full name.
- FIPS codes are strings with leading zeros.

## 5. Scoring model

All of this is in [`app/domain/scoring.py`](../backend/app/domain/scoring.py) and [`app/domain/hazards.py`](../backend/app/domain/hazards.py).

**These are decisions made for the demo, not validated risk science.** [`human-review.md`](human-review.md) lists each one with alternatives.

### Overall score

```
overall score = 40% historical + 40% live + 20% wildfire model
```

The historical and live parts work per hazard, and the hazards are then combined into a hazard composite (below). So in code it's:

```
hazard score    = 50% baseline + 50% live          (their 40:40 ratio)
hazard composite = 60% highest hazard + 40% mean of the top three
overall          = 80% hazard composite + 20% wildfire model score
```

This is `compositeScore` in the API. The weights are `OVERALL_HISTORICAL_WEIGHT`, `OVERALL_LIVE_WEIGHT` and `OVERALL_WILDFIRE_MODEL_WEIGHT` in `scoring.py`, and `frontend/lib/scoring.ts` mirrors them for the site's text.

Only wildfire has a model, so the overall score has a **wildfire bias by design**: a county with high wildfire ignition odds scores higher overall than one with the same hazard scores and low odds. Individual hazard scores, including Wildfire's, don't include the model. Neither does the map when it's filtered to one hazard.

If there's no model score for an area (the file is missing, more than `WILDFIRE_MODEL_MAX_AGE_DAYS` past its week, or had no weather for that county), the overall score is the hazard composite alone. It isn't scored as if the model had said 0.

### Hazard score

```
hazard score = 50% baseline + 50% live
```

With no live signal, a hazard therefore can't exceed 50. In practice most scores are between 0 and 50.

There are six hazards: Wildfire, Earthquake, Flood, Severe Storm, Hurricane and Tornado.

### Baseline (0 to 100)

The baseline is a county's percentile rank for that hazard since 2006, among counties that have had the hazard at all. A county with no history scores 0. Excluding unaffected counties stops rare hazards being inflated: one tornado declaration would otherwise rank at the 93rd percentile.

| Hazard | What's counted |
|---|---|
| Earthquake | USGS M4.5+ earthquakes within 60 miles of the county's bounding box |
| All others | Distinct FEMA major disaster and fire declarations covering the county |

FEMA emergency declarations (`EM`) are excluded, because many cover other states' evacuees rather than local damage. COVID-19 and other "Biological" incidents are also excluded. `FEMA_INCIDENT_HAZARDS` maps FEMA's incident types to hazards.

### Live (0 to 100)

Each source produces a `LiveSignal` of hazard, score and explanatory text. For each hazard, the **strongest signal wins**, and its text becomes that hazard's `warning`. With no signal, the warning describes the baseline instead.

| Source | Rule | Live score |
|---|---|---|
| NWS alerts | Each event type has a fixed score in `ALERT_RULES`, e.g. Red Flag Warning | 100 |
| | Flood Warning | 85 |
| | Wind Advisory | 35 |
| USGS, past 7 days | M5.5+ within 20 mi of the county | 100 |
| | M4.5+ within 30 mi | 75 |
| | M3.0+ within 30 mi | 45 |
| Open-Meteo, next 24h | One hour with humidity ≤ 15% and gusts ≥ 25 mph (Wildfire) | 80 |
| | Gusts ≥ 58 mph (Severe Storm) | 100 |
| | Gusts ≥ 40 mph (Severe Storm) | 70 |
| NWPS gauges | Major / moderate / minor flood, observed or forecast (Flood) | 100 / 85 / 70 |
| | Action stage (Flood) | 40 |

Weather below its thresholds scores 0 but still supplies the warning text.

### Hazard composite

```
hazard composite = 60% highest hazard + 40% mean of the top three hazards
```

A plain average would let hazards that don't apply to a place hide the one that does.

### Wildfire model (0 to 100)

The XGBoost model in [`ml/wildfire/`](../backend/ml/wildfire/README.md) estimates, per county, the calibrated probability that a large wildfire (MTBS: about 1,000+ acres in the West, 500+ in the East) starts that week. The API doesn't run it: it needs xgboost, pandas and 180 days of NASA POWER weather per grid cell. Instead, a weekly job writes one JSON file:

```bash
# From backend/, with requirements-ml.txt installed. About 30 minutes, mostly NASA POWER downloads.
python -m ml.wildfire.predict_week
```

`services/wildfire_model.py` checks the document's version (a file's mtime, an S3 object's ETag) whenever the snapshot is rebuilt (every minute), in a worker thread, so a new week is picked up without a restart. If a check fails, the last good week is kept until it goes stale. `/api/health` reports it under `sources.wildfireModel`, including its location.

**Moving the job to AWS.** The job and the API only share [`weekly_scores/`](../backend/weekly_scores/__init__.py): the document format (`contract.py`) and where it's stored (`store.py`). To migrate:

1. Run [`ml/wildfire/handler.py`](../backend/ml/wildfire/handler.py)'s `lambda_handler` (or `python -m ml.wildfire.predict_week` in a container) from an EventBridge schedule, with `WILDFIRE_MODEL_URI=s3://<bucket>/<key>`. The handler's docstring covers packaging and the runtime limit: the run takes about 30 minutes, which is over Lambda's 15.
2. Set the API's `WILDFIRE_MODEL_URI` to the same `s3://` URI, add `boto3` to `requirements.txt`, and give the API `s3:GetObject` on that key.

No scoring code changes. To store it somewhere else, such as Supabase, add a store class with `version`, `read`, `write` and `describe`.

The script uses observed NASA POWER weather for the days before the week, and fills in the days POWER doesn't have yet from the Open-Meteo forecast. Counties with no weather for the week are left out of the file.

Probabilities are small (a typical county-week is well under 1%), so `wildfire_model_score` scores them on a log scale, clamped at both ends:

| Weekly probability | Model score |
|---|---|
| 0.01% or less | 0 |
| 0.1% | 33 |
| 1% | 67 |
| 10% or more | 100 |

The 10% ceiling also keeps the calibrator's top step, which reaches 100% from only 8 calibration rows, from showing as certainty (see the model README).

### Tiers

| Tier | Score |
|---|---|
| Critical | 75 and up |
| Elevated | 50 to 74 |
| Moderate | 30 to 49 |
| Low | Below 30 |

The backend assigns tiers. The map's colour bands are different: see [frontend-doc.md](frontend-doc.md#colours-and-legends).

### States

A state's hazard scores are the population-weighted average of its counties, and its hazard composite is calculated from those. Its wildfire model score is the population-weighted average over its counties that have one, and its overall score combines the two the same way as a county's. Puerto Rico has no Census population data, so its municipios are weighted equally.

### Why a county's map colour can differ from its sidebar score

| | Baseline | NWS alerts | USGS | Open-Meteo | NWPS |
|---|---|---|---|---|---|
| `/map-values`, `/states/{code}` | Yes | Yes | Yes | No | No |
| `/counties/{fips}` | Yes | Yes | Yes | Yes | Yes |

Weather and gauges can't be fetched for 3,221 counties (see [`apis-usage.md`](apis-usage.md)). Because they only score above advisory thresholds, the two numbers usually match. They differ when local conditions are hazardous but no NWS alert covers them.

## 6. Expected annual loss (FEMA NRI)

[`scripts/build_reference_data.load_nri`](../backend/scripts/build_reference_data.py) pages through FEMA's official **National Risk Index Counties** ArcGIS feature service. OpenFEMA's API doesn't serve the NRI ("Files Only"), so this is the closest thing to an API. The request is in [`apis-usage.md`](apis-usage.md#fema-national-risk-index).

### Hazards

NRI models 18 hazards. Only the 11 that match ours count, mapped by `NRI_HAZARDS` in `domain/hazards.py`:

| Our hazard | NRI hazards counted (NRI code) |
|---|---|
| Wildfire | Wildfire (`WFIR`) |
| Earthquake | Earthquake (`ERQK`) |
| Flood | Inland flooding (`IFLD`), coastal flooding (`CFLD`) |
| Severe Storm | Strong wind (`SWND`), hail (`HAIL`), lightning (`LTNG`), ice storm (`ISTM`), winter weather (`WNTW`) |
| Hurricane | Hurricane (`HRCN`) |
| Tornado | Tornado (`TRND`) |

The other 7 are left out of **every** loss figure: avalanche, cold wave, drought, heat wave, landslide, tsunami and volcanic activity (`NRI_EXCLUDED_HAZARDS`). Nationally, the counted hazards are 85.8% of NRI's total expected loss of $153.8B a year.

### What the numbers mean

- **Loss** is NRI's `<CODE>_EALT` field, summed over the counted hazards, in dollars per year. A null field means the hazard doesn't apply, and counts as $0.
- `_EALT` is building loss + agriculture loss + **population loss: expected deaths and injuries at FEMA's dollar value**. Nationally that last part is $40.7B of the total. These are modeled estimates, not money actually lost.
- **Per person** is the total ÷ NRI's `POPULATION`, which is what NRI's own figures use. It isn't our Census population.
- **`lossPerPersonPercentile`** ranks a county's loss per person among all of NRI's 3,222 counties in our 52 states and territories. Ties take the middle of their range.
- **High-loss county:** loss per person at or above the 80th percentile, which is **$732.52 per person per year** in this release (`HIGH_LOSS_PERCENTILE`). A state's `highLossPopulationPct` is the share of its NRI population living in high-loss counties.
- **Social vulnerability and community resilience** are NRI's `SOVI_RATNG` and `RESL_RATNG`, "Very Low" to "Very High". They cover all 18 hazards, not just ours. "Data Unavailable" becomes `null`.

### County codes

NRI uses current county codes. Ours come from an older boundary file.

| Case | Handling |
|---|---|
| Renamed: `02158` Kusilvak, `46102` Oglala Lakota | Mapped to our `02270`, `46113` (`NRI_TO_OUR_FIPS`) |
| Split: Valdez-Cordova `02261` became `02063` and `02066` in 2019 | Both map to `02261`. Losses and population are added together. Ratings are dropped, because they can't be combined |
| Connecticut: NRI uses its 9 planning regions (`09110` to `09190`) | No county-level data for its 8 counties. **State totals use every NRI row in the state**, so Connecticut's state figures are complete |
| Bedford city, VA (`51515`), merged in 2013 | No data |
| American Samoa, Guam, Northern Mariana Islands, Virgin Islands | Dropped; they aren't on the map |

So 3,212 of our 3,221 counties have NRI data.

## 7. Caching and failure handling

[`core/cache.py`](../backend/app/core/cache.py) is an in-memory, per-process cache. Its contents are lost on restart, and the snapshot is refilled in the background at startup.

| Cache key | Lifetime |
|---|---|
| `nws:alerts`, `usgs:recent` | 5 minutes |
| `snapshot` (computed scores) | 1 minute. Each rebuild also re-reads the wildfire model document if its version changed |
| `openmeteo:forecast:{fips}` | 30 minutes |
| `nwps:gauges:{fips}` | 15 minutes |
| `openmeteo:geocode:{query}` | 24 hours |

Reference and NRI data isn't cached: it's held in memory for the life of the process.

When an upstream call fails:

1. If the cached value is less than **1 hour** old, it's served. Older data isn't used, so old alerts never appear as current.
2. Otherwise the source counts as unavailable, and scoring carries on without it.
3. That key isn't retried for 60 seconds, so a dead upstream doesn't slow every request.

What users see when a source is unavailable:

| Field | Text |
|---|---|
| `activeAlert`, `primaryAlert` | `"NWS alert feed unavailable, so alert status is unknown"` |
| Affected hazards' `warning` | `"4 federal flood declarations since 2006 (live data unavailable)"` |

**NWS has a second fallback: the Lambda's alert archive.** When NWS fails and the cache has nothing under an hour old, `_build_snapshot` asks [`services/alert_archive.py`](../backend/app/services/alert_archive.py) for the alerts active at the Lambda's last run, if that run is within `ALERT_ARCHIVE_MAX_AGE_MINUTES` (90; use 30 with 15-minute runs). Every alert text then ends `(as of 14:15 UTC; live NWS feed unavailable)`, and a county with none says `No active alerts (as of ...)`. `/api/health` shows `nwsArchiveAsOf` while it's in use. It's the only database read after startup, in a worker thread during NWS outages only. If the archive is stale or unreachable, the normal "unavailable" text applies.

**NWPS has its own backoff.** A 429 pauses all NWPS calls for 5 minutes, for every county, because its limits aren't published.

**If the database is unreachable at startup,** the API doesn't start. It doesn't need the database after that.

## 8. Database

Supabase Postgres, free plan, US East region. Only the backend uses it, as the `postgres` role, which bypasses row level security. **Every table has RLS enabled with no policies**, so Supabase's public Data API (the anon and authenticated keys) can't read or write any of them.

| Table | Rows | Contents |
|---|---|---|
| `hazards` | 6 | Hazard codes and labels |
| `states` | 52 | 50 states, DC and PR |
| `counties` | 3,221 | Name, centroid, bounding box, Census population |
| `county_hazard_baselines` | 19,326 | Per county and hazard: event count and baseline percentile |
| `state_hazard_declarations` | 260 | Per state and hazard: distinct FEMA declarations |
| `reference_meta` | 1 | When and how the baseline was built |
| `nri_meta` | 1 | NRI version and the high-loss threshold |
| `nri_county_profiles` | 3,212 | NRI population, ratings, loss-per-person percentile |
| `nri_county_losses` | 19,272 | Per county and hazard: expected annual loss |
| `nri_state_profiles` | 52 | NRI population and residents in high-loss counties |
| `nri_state_losses` | 312 | Per state and hazard: expected annual loss |
| `nws_alert_archive` | ~200k a year | County-level NWS alerts, written by the Lambda ([`aws/lambda_function.py`](../backend/aws/lambda_function.py)), kept `retention_days`. Slim rows: no raw response or description |
| `archive_settings` | 1 | `retention_days` (365) and the Lambda's `last_run_at`. Edit retention in Supabase's Table Editor |
| `api_config` | 1 | The Lambda's NWS URL, parameters and User-Agent (`nws_alerts`) |

The tables the old Lambda tasks wrote (`locations`, `weather_observations`, `earthquakes`, `weather_alerts`, `gauges`) were dropped by [`db/migrations/2026-11-26_nws_alert_archive.sql`](../backend/db/migrations/2026-11-26_nws_alert_archive.sql), which moves the last year of `weather_alerts` into the archive first.

The tables use foreign keys between them (counties to states, baselines to counties and hazards, and so on) and `CHECK` constraints on ranges.

### Changing the schema

- **New table:** add `CREATE TABLE IF NOT EXISTS` and its `ENABLE ROW LEVEL SECURITY` line to `schema.sql`. It's created on the next startup. If it holds reference data, add it to `REFERENCE_TABLES` in `db.py` (children before parents) and load it in `seed_reference`.
- **Changed table:** not automatic, because `CREATE TABLE IF NOT EXISTS` won't alter an existing table. Run an `ALTER TABLE` in the Supabase SQL editor, and update `schema.sql` to match. Prefer adding a new table where you can.

### `reference.json` format

`data/reference.json` is both the seed for the database and the format `load_raw` rebuilds from the tables:

```jsonc
{
  "meta": { "generatedAt": "2026-11-14T19:10:33+00:00", "baselineSinceYear": 2006, "quakeMinMagnitude": 4.5, "quakeRadiusMiles": 60 },
  "states": {
    "CA": { "name": "California", "declarations": { "wildfire": 217, "flood": 6, "...": 0 } }
  },
  "counties": {
    "06065": {
      "name": "Riverside County", "bareName": "Riverside", "state": "CA",
      "lat": 33.7435, "lon": -115.9957,
      "bbox": [-117.6737, 33.4259, -114.4349, 34.0797],   // west, south, east, north
      "population": 2458395,
      "counts":   { "wildfire": 21, "earthquake": 47, "...": 0 },
      "baseline": { "wildfire": 100, "earthquake": 89, "...": 0 }
    }
  },
  "nri": {
    "meta": { "version": "December 2025", "highLossPercentile": 80, "highLossPerPersonThreshold": 732.52 },
    "counties": {
      "06065": {
        "population": 2416838, "socialVulnerability": "Relatively Low", "communityResilience": "Very Low",
        "lossPerPersonPercentile": 89, "losses": { "flood": 1127003661.31, "earthquake": 763784550.11, "...": 0 }
      }
    },
    "states": { "CA": { "population": 39501350, "highLossPopulation": 24477926, "losses": { "...": 0 } } }
  }
}
```

A snapshot without the `nri` section can't be seeded: `seed_reference` raises an error asking for `--refresh`.

County IDs come from the same GeoJSON file the frontend draws, so every `MapValue.id` matches a polygon. The score data uses each county's **largest polygon** for the centroid and box, so that distant islands don't stretch them. Census population is missing for Puerto Rico's 78 municipios and for `51515`. Those show `"N/A"`.

## 9. Common changes

| To change | Edit |
|---|---|
| Which alerts count, or their scores | `ALERT_RULES` in `domain/hazards.py` |
| Which FEMA incidents count | `FEMA_INCIDENT_HAZARDS` in `domain/hazards.py`, then `init_db --refresh` |
| Which NRI hazards count toward losses | `NRI_HAZARDS` and `NRI_EXCLUDED_HAZARDS` in `domain/hazards.py`, then `init_db --refresh`. Also update `frontend/lib/nri.ts` |
| The high-loss cutoff | `HIGH_LOSS_PERCENTILE` in `scripts/build_reference_data.py`, then `init_db --refresh`. Also update the "top 20%" wording in the frontend |
| Tier cutoffs, weights or thresholds | `domain/scoring.py` |
| The 40/40/20 overall split, or the model's log scale | `OVERALL_*_WEIGHT` and `MODEL_PROBABILITY_*` in `domain/scoring.py`. Also update `frontend/lib/scoring.ts` and the /about text |
| This week's wildfire model scores | Run `python -m ml.wildfire.predict_week` (weekly) |
| Cache lifetimes, CORS origins, User-Agent | `app/config.py` or `backend/.env` |
| A response field | `app/schemas.py` and `frontend/lib/types.ts`, together |

**To add a hazard:** add it to `Hazard` and `_LABELS`, add its table entries (including `NRI_HAZARDS` if NRI models it), add it to `MapMetric` in `services/risk.py`, then run `init_db --refresh`.

**To add a live source:** add a client in `clients/` that returns plain dataclasses, fetch it through the cache in `RiskService`, convert the result to `LiveSignal`s and merge them. If it's nationwide, do this in `snapshot.py` so the map benefits. Then document it in `apis-usage.md`.

## 10. Known limitations

- **The wildfire model runs on forecast weather.** It was trained on NASA POWER reanalysis, and this week's days come from Open-Meteo's forecast, which has different biases (especially wind and humidity). The scores haven't been validated against forecast inputs yet. Above about 0.3% it also overestimated by about a quarter in 2021-2024 (see the model README).
- **Nothing schedules the model yet.** Someone has to run `predict_week` each week. Without it, the file goes stale after `WILDFIRE_MODEL_MAX_AGE_DAYS` and the overall score quietly drops back to the hazard composite. `/api/health` shows `wildfireModel.available: false` when that happens.
- **Baseline is a proxy.** Declarations measure federal response rather than physical risk, and they depend on how FEMA labels events: many tornadoes are filed under "Severe Storm". The NRI losses are a better long-term measure, but they're shown separately and don't feed the score.
- **Expected loss is modeled and partial.** It leaves out 7 NRI hazards, including heat and drought, and includes a dollar value for deaths and injuries.
- **Connecticut has no county-level losses,** because NRI reports planning regions.
- **Weather is sampled at one point,** the county's centroid. For large counties this can be far from where people live. Riverside's is in the desert.
- **County boundaries are approximate.** Quake and gauge lookups use bounding boxes, so they can catch events just outside a county.
- **Tribal lands.** FEMA declarations for tribal areas have no county, so they count toward the state's declaration total but not toward any county's baseline.
- **River flooding hasn't been seen live.** Live NWPS responses were parsed without errors, but none showed a gauge above flood stage. That branch was only tested with sample data.
- **The cache is per-process.** Running several workers multiplies upstream calls.
- **The database is a single point of failure at startup.** If Supabase is paused (free projects pause after about a week of inactivity) or unreachable, the API won't start. Open the Supabase dashboard and restore the project before a demo.
- **Informational only.** This isn't a substitute for official warnings. The repo README says so, but the site itself doesn't show a disclaimer yet (see [`human-review.md`](human-review.md)).

## 11. How the frontend connects

The browser calls this API directly, through [`frontend/lib/api.ts`](../frontend/lib/api.ts). The browser never talks to Supabase. [The frontend doc](frontend-doc.md#calls-by-user-action) lists which user action makes which call.

- The base URL is `NEXT_PUBLIC_API_URL`, which defaults to `http://localhost:8000/api`.
- CORS allows `http://localhost:3000` and `http://127.0.0.1:3000`, for `GET` only.

### Deploying

At this snapshot the frontend has been deployed but the backend hasn't, so the deployed site can't load any data. It falls back to `http://localhost:8000/api`, which each visitor's browser looks for on their own machine.

**Host the backend as a long-running server, not as serverless functions** such as Vercel's Python runtime. The design depends on staying up: it loads the reference data once at startup, warms the national snapshot in a background task, and caches live feeds in memory across requests. A free Render web service fits, and connects to GitHub to redeploy on every push. The repo owner is setting one up.

| Setting | Value |
|---|---|
| Root directory | `backend` |
| Build command | `pip install -r requirements.txt` |
| Start command | `uvicorn app.main:app --host 0.0.0.0 --port $PORT` |
| Health check path | `/api/health` |
| `DATABASE_URL` | The Supabase session pooler string |
| `CORS_ORIGINS` | A JSON list with the site's origin, no trailing slash, e.g. `["https://<site>.vercel.app"]` |
| `PYTHON_VERSION` | Pin one the dependencies build on, e.g. `3.13.1` |

Then on the frontend host, set `NEXT_PUBLIC_API_URL` to the backend URL **including `/api`**, and redeploy, because Next.js fixes it at build time. Both URLs must be `https`, or browsers block the calls as mixed content.

On a free tier that sleeps when idle (Render's does after 15 minutes), the first request after a sleep waits for the server to start and reload its data from Supabase.

| Symptom in the browser's dev tools | Cause |
|---|---|
| Requests to `localhost:8000`, `ERR_CONNECTION_REFUSED` | `NEXT_PUBLIC_API_URL` unset, or set without a redeploy |
| "blocked by CORS policy" | The site's origin isn't in `CORS_ORIGINS` |
| "Mixed Content" | The API URL is `http://` |
| 404 on `/states/...` or `/map-values` | `NEXT_PUBLIC_API_URL` is missing `/api` |
| 5xx, or a very slow first request | The backend crashed (check `DATABASE_URL`) or is waking up |

## 12. Guidance for coding agents

- Never print, log or commit the contents of `backend/.env`. To check it, print key names only. The same goes for the hosting platform's environment variables.
- Don't commit. The team makes all commits.
- Keep `app/schemas.py` and `frontend/lib/types.ts` in sync.
- Put scoring rules in `domain/`, and don't add I/O there.
- Don't add per-county upstream calls to `/map-values`. There are 3,221 counties, and the quotas are shared.
- Don't query the database per request. Load what you need at startup.
- Never replace "unavailable" text with "no alerts". The distinction matters on a safety site.
- Avoid repeatedly calling NWPS while testing. It rate-limited us after a few dozen requests in one session.
- `init_db --refresh` and `--reseed` write to the shared Supabase database that the whole team uses.
- Give every new function a docstring in the existing format.
- Update this doc, `backend/README.md` and `apis-usage.md` when you change endpoints, sources, tables or scoring. For scoring weights, also update `frontend/lib/scoring.ts` and the /about page.
- Don't import `ml/` from `app/`, or `app/` from `ml/`. The API must run on `requirements.txt` alone, and the job must run without FastAPI. They meet only in `weekly_scores/`, which stays standard-library only (boto3 imported lazily).

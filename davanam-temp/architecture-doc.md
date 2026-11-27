# Architecture: how Risk Resource fits together

This shows every part of the app as boxes and arrows: what runs where, what calls what, and how often. It describes the setup on `feature/add-model-scoring` as of 2026-11-26. For what changed and why, see [overview.md](overview.md). For step-by-step AWS setup, see [aws-step-by-step/](aws-step-by-step/README.md).

## The whole system

Three places run code: **Vercel** (the website), **Railway** (the backend API) and **AWS** (two scheduled jobs). **Supabase** and **S3** store data. Everything else is a free public API.

```
                                   ┌──────────────┐
                                   │   Browser    │
                                   └──────┬───────┘
                                          │ loads pages
                                          ▼
                           ┌──────────────────────────────┐
                           │  Website: Next.js on Vercel  │
                           └──────────────┬───────────────┘
                                          │ JSON requests (/api/...)
                                          ▼
┌──────────────────────┐   live, every     ┌──────────────────────────────────────┐   at startup   ┌────────────────────────┐
│   Live public APIs   │   few minutes     │   Backend API: FastAPI on Railway    │ ─────────────▶ │  Supabase (Postgres)   │
│ NWS · USGS ·         │ ◀──────────────── │   Computes every score               │                │  Reference data        │
│ Open-Meteo · NWPS    │                   │                                      │ ◀───────────── │  Alert archive         │
└──────────────────────┘                   └───────────────────▲──────────────────┘  only if NWS   └───────────▲────────────┘
                                                               │                     is down                   │
                                                               │ checks every minute                           │ every 15 min
                                                               │ (weekly scores file)                          │
                                           ┌───────────────────┴──────────────────┐                ┌───────────┴────────────┐
                                           │  S3: wildfire/latest.json            │                │  AWS Lambda:           │
                                           └───────────────────▲──────────────────┘                │  NWS alert archive     │
                                                               │ every Monday                      └───────────▲────────────┘
                                           ┌───────────────────┴──────────────────┐                            │
                                           │  AWS Step Functions:                 │                ┌───────────┴────────────┐
                                           │  weekly wildfire pipeline            │                │  EventBridge Scheduler │
                                           └───────────────────▲──────────────────┘                │  every 15 minutes      │
                                                               │                                   └────────────────────────┘
                                           ┌───────────────────┴──────────────────┐
                                           │  EventBridge Scheduler               │
                                           │  Mondays 06:00 UTC                   │
                                           └──────────────────────────────────────┘
```

**Until Railway is switched to S3,** the backend reads the scores file committed in its own code (`backend/data/wildfire_model.json`) instead of S3. Switching is one setting, `WILDFIRE_MODEL_URI`. See [railway-changes.md](railway-changes.md).

| Piece | Runs on | Code |
|---|---|---|
| Website | Vercel, deployed from `main` | `frontend/` |
| Backend API | Railway, deployed from `main` | `backend/app/` |
| Reference data and alert archive | Supabase (free plan) | `backend/db/schema.sql` |
| Weekly wildfire pipeline | AWS: EventBridge, Step Functions, 3 Lambdas, ECR, S3 | `backend/aws/wildfire_steps.py`, `backend/aws/wildfire_state_machine.json` |
| NWS alert archive | AWS: EventBridge, 1 Lambda | `backend/aws/lambda_function.py` |

## A page load, step by step

What happens when someone opens a county on the map:

```
 Browser
   │  1. opens /map, clicks a county (or types an address)
   ▼
 Website (Vercel)
   │  2. GET /api/map              colours for every county
   │     GET /api/counties/{fips}  that county's full breakdown
   ▼
 Backend API (Railway)
   │
   ├─ 3. Map colours: read the current snapshot (at most a minute old, see below). No outside calls.
   │
   └─ 4. County details: the snapshot's scores, plus that county's own data
         │
         ├──▶ Open-Meteo forecast  (wind gusts, humidity)    cached 30 min per county
         ├──▶ NOAA NWPS gauges     (river flood stages)       cached 15 min per county
         │
         ▼
      5. Re-score that county with the extra data, return JSON
   │
   ▼
 Website draws the score, the hazard bars, the Wildfire Model section and the alerts
```

The backend never waits on the database during a request: everything it needs from Supabase is loaded into memory at startup.

| Endpoint | Returns |
|---|---|
| `GET /api/map` | One value per county or state, for colouring the map |
| `GET /api/counties/{fips}` | A county's overall score, each hazard, the wildfire model, alerts, FEMA's expected losses |
| `GET /api/states/{code}` | The same for a state, population-weighted over its counties |
| `GET /api/search?q=...` | Counties matching a name, city or ZIP (Open-Meteo geocoding, cached 24 h) |
| `GET /api/health` | The state of every data source, including the wildfire model file and the alert backup |

## Inside the backend

```
                    ┌───────────────────────────── Backend API (FastAPI) ─────────────────────────────┐
                    │                                                                                  │
  Supabase ────────▶│  At startup: Reference data (in memory)                                          │
  (once)            │    counties · disaster history since 2006 · FEMA expected losses · population   │
                    │                                   │                                              │
                    │                                   ▼                                              │
  NWS alerts ──────▶│  Live feeds (cached 5 min) ──▶  Snapshot (at most 1 min old)     ◀── Wildfire     │◀── weekly
  USGS quakes ─────▶│                                  scores for 3,221 counties             model      │    scores file
                    │                                  and every state                       reader     │    (local or S3)
                    │                                   │                                              │
  Supabase ────────▶│  Alert archive reader ────────────┘  (only when NWS fails)                       │
  (archive)         │                                                                                  │
                    │                                   ▼                                              │
                    │  Routers: /api/map · /api/counties · /api/states · /api/search · /api/health     │
                    └──────────────────────────────────────────────────────────────────────────────────┘
```

| Component | What it does |
|---|---|
| **Scoring rules** (`app/domain/scoring.py`) | Every formula and threshold, with no network or database calls |
| **Snapshot** (`app/services/snapshot.py`) | Scores every county and state from the nationwide feeds and the wildfire model. There's no timer: it's rebuilt on demand, by the first request that finds it more than 60 seconds old, and once at startup |
| **Risk service** (`app/services/risk.py`) | Builds each response, adding a county's own forecast and gauges when it's opened |
| **Wildfire model reader** (`app/services/wildfire_model.py`) | Re-reads the scores file when it changes; ignores it once it's more than 13 days past its week |
| **Alert archive reader** (`app/services/alert_archive.py`) | When NWS can't be reached, uses the Lambda's latest saved alerts, if they're recent enough (`ALERT_ARCHIVE_MAX_AGE_MINUTES`: 90 by default, 30 once set on Railway) |

**If an outside API fails,** the backend keeps serving its last good copy for up to an hour, and `/api/health` shows which source is down.

## How a score is built

```
  For each of the 6 hazards (wildfire, severe storm, flood, hurricane, tornado, earthquake):

    History (0-100)                        Live conditions (0-100)
    FEMA declarations since 2006,          strongest current signal: NWS alerts,
    as a percentile (earthquakes: USGS     forecast gusts and humidity, river gauges,
    M4.5+ within 60 mi)                    recent earthquakes. Usually 0
            │                                          │
            └────────────── 50 / 50 ───────────────────┘
                               │
                               ▼
                     Hazard score (0-100)  × 6
                               │
                               ▼
          Combine hazards: 60% the highest + 40% the average of the top three
                               │
                               ▼
                     Hazard composite (0-100)        Wildfire model (0-100)
                               │                     this week's chance of a large
                               │                     wildfire starting, on a log scale
                               │                                │
                               └────────────── 80 / 20 ─────────┘
                                                  │
                                                  ▼
                               Overall threat score (0-100)
                       Low 0-29 · Moderate 30-49 · Elevated 50-74 · Critical 75-100
```

Net effect: **40% history, 40% live, 20% wildfire model**. If the model has no score for a county, the overall score is the hazard composite alone.

## Pipeline 1: the weekly wildfire scores (AWS)

The model needs 180 days of weather for about 1,895 locations. At the 60 requests a minute NASA POWER allows, that takes about 30 minutes, which is longer than one Lambda may run (15). So Step Functions runs it in steps.

```
 EventBridge Scheduler ── Mondays 06:00 UTC ──▶ Step Functions: wildfire-weekly
                                                        │
        ┌───────────────────────────────────────────────┘
        ▼
 ┌──────────────────────────────────────────────────────────────┐         ┌───────────────┐
 │ 1. DownloadWeather (Map: 8 chunks, one at a time)            │ ◀─────▶ │  NASA POWER   │
 │    Lambda wildfire-fetch-chunk, ~4 min per chunk             │         │  60 req / min │
 │    Rate-limited? → Throttled → wait 60 s, 120 s, ... → retry │         └───────────────┘
 │    Out of time?  → ChunkIncomplete → retry, skipping done    │
 └──────────────────────────────┬───────────────────────────────┘
                                │ writes S3 raw/{week}/.../{cell}.parquet
                                ▼
 ┌──────────────────────────────────────────────────────────────┐         ┌───────────────┐
 │ 2. BuildFeatures                                             │ ◀─────▶ │  Open-Meteo   │
 │    Lambda wildfire-build-features                            │         │  forecast     │
 │    reads all weather, adds the forecast, builds 36 features  │         └───────────────┘
 └──────────────────────────────┬───────────────────────────────┘
                                │ writes S3 features/{week}/features.csv + fips.json
                                ▼
 ┌──────────────────────────────────────────────────────────────┐
 │ 3. CalibrateAndPublish                                       │
 │    Lambda wildfire-calibrate-publish                         │
 │    runs the XGBoost model (< 1 s), calibrates, publishes     │
 └──────────────────────────────┬───────────────────────────────┘
                                │ writes S3 wildfire/weeks/{week}.json, then wildfire/latest.json
                                ▼
                      Backend notices the new file within a minute
```

```
 How the code gets there (once per code or model change):

 laptop: docker build ──▶ ECR: riskresource-wildfire:latest ──▶ the 3 Lambdas (same image,
                                                                  different CMD override)
```

| Step | Lambda | Memory / timeout | Output in S3 |
|---|---|---|---|
| 1. Download weather | `wildfire-fetch-chunk` (×8) | 1 GB / 15 min | `raw/` (kept 14 days) |
| 2. Forecast + features | `wildfire-build-features` | 3 GB / 15 min | `features/` (kept 30 days) |
| 3. Model + publish | `wildfire-calibrate-publish` | 1 GB / 5 min | `wildfire/latest.json`, `wildfire/weeks/` (kept 1 year) |

A full run takes 30 to 45 minutes and costs nothing within the free tier. If a step fails after its retries, the run shows red in the Step Functions console and the site keeps the previous week's scores.

## Pipeline 2: the NWS alert archive (AWS)

NWS only shows alerts that are active right now. This keeps a year of them, and gives the backend a backup when NWS is unreachable.

```
 EventBridge Scheduler ── every 15 min ──▶ Lambda nws-alert-archive ──▶ NWS active alerts (1 call)
                                                   │
                                                   │ keep alerts that cover a county
                                                   ▼
                                    ┌──────────── Supabase ────────────┐
                                    │ nws_alert_archive  ◀── upsert    │
                                    │ archive_settings   ◀── last_run  │
                                    │                    ──▶ delete    │
                                    │      alerts older than           │
                                    │      retention_days (365)        │
                                    └─────────────────┬────────────────┘
                                                      │
                                                      ▼
                              Backend reads it only when NWS fails
                              ("as of HH:MM UTC; live NWS feed unavailable")
```

## Where data lives

```
 ┌──────────────── Supabase (Postgres) ────────────────┐      ┌─────────── S3: riskresource-data-bucket ────────────┐
 │ Reference data (written by init_db --refresh)       │      │ raw/{week}/...        weather downloads (14 days)   │
 │   counties · states · hazards                       │      │ features/{week}/...   model input (30 days)         │
 │   county_hazard_baselines · state_hazard_decl...    │      │ wildfire/weeks/       every week's scores (1 year)  │
 │   nri_* (FEMA expected losses) · reference_meta     │      │ wildfire/latest.json  what the backend reads        │
 │ Alert archive (written by the Lambda)               │      └─────────────────────────────────────────────────────┘
 │   nws_alert_archive · archive_settings              │
 │ Lambda config: api_config (nws_alerts)              │      ┌──────────── ECR: riskresource-wildfire ─────────────┐
 └─────────────────────────────────────────────────────┘      │ the pipeline's Docker image (last 3 kept)           │
                                                              └─────────────────────────────────────────────────────┘
```

| Store | Written by | Read by | Size |
|---|---|---|---|
| Supabase reference data | The backend's build script, by hand | The backend, once at startup | About 16 MB, the whole database today |
| Supabase alert archive | The alert Lambda, every 15 minutes | The backend, only when NWS is down | About 150-250 MB at a full year (free plan: 500 MB) |
| S3 `wildfire/latest.json` | The weekly pipeline | The backend, checked at each snapshot rebuild (at most once a minute) | About 50 KB |
| S3 `raw/`, `features/` | The weekly pipeline | Later steps of the same run | Tens of MB, expired automatically |
| ECR image | You, with `docker push` | The 3 wildfire Lambdas | About 1 GB |

## When something fails

| If this fails | What the site does |
|---|---|
| NWS | Shows the archive's alerts (if recent enough: 30 minutes once Railway is updated, 90 until then), labelled with their time |
| USGS, Open-Meteo or NWPS | Keeps the last good copy for up to an hour; that hazard's live part may read 0 |
| A weekly pipeline run | Keeps last week's scores until they're 13 days old, then scores without the model |
| The alert Lambda | Nothing visible, unless NWS is also down |
| Supabase | The backend can't start, but a running backend keeps working (data is in memory) |

# Architecture overview: what changed and what each piece does

This covers the backend, Supabase and AWS: how they fit together after the changes on `feature/add-model-scoring`, and what each component is responsible for. The frontend only changed in what it displays, so it's summarized briefly at the end.

## Before and after

**Before:** the backend scored each county from two things, its disaster history and live conditions (50/50). An AWS Lambda collected several raw data feeds into Supabase, but nothing read them. The wildfire model existed only as training code and notebooks.

**After:**

- **The score has a third ingredient.** Overall = 40% history + 40% live + 20% wildfire model. The model forecasts each county's weekly chance of a large wildfire starting.
- **A weekly job runs the model** and publishes one small results file. The backend reads that file; it never runs the model itself.
- **The Lambda has one focused job:** archiving National Weather Service alerts for a rolling year. The backend uses the archive as a backup when NWS is unreachable.
- **Supabase lost five unused tables and gained two small ones.** It stays the source of truth for reference data.

```
                       ┌──────────────────────────── Live public APIs ─────────────────────────────┐
                       │  NWS alerts · USGS earthquakes · Open-Meteo forecast · NOAA river gauges  │
                       └───────────────▲───────────────────────────────────────▲──────────────────┘
                                       │ every few minutes                     │ every 15 min
                                       │                                       │
 Browser ──▶ Website (Vercel) ──▶ Backend API (FastAPI, Railway) ◀──────┐   AWS Lambda: alert archive
                                       │        ▲                       │      (EventBridge schedule)
                          at startup   │        │ only if NWS is down   │              │
                                       ▼        │                       │              ▼
                                ┌──────────── Supabase (Postgres) ──────┴──────────────────────┐
                                │  Reference data: counties, disaster history, FEMA losses     │
                                │  Alert archive: nws_alert_archive + archive_settings         │
                                └──────────────────────────────────────────────────────────────┘
                                       ▲
                                       │ reads every minute (weekly scores file)
                                       │
                         Weekly wildfire job (predict_week) ◀── NASA POWER + Open-Meteo weather
                         today: run by hand, file committed
                         planned: AWS Step Functions → S3
```

## Backend (FastAPI on Railway)

The backend combines everything into scores and serves them to the website. It loads slow-changing data from Supabase once at startup, keeps live feeds in memory for a few minutes, and never waits on the database during a normal request.

| Component | What it does | Changed? |
|---|---|---|
| **Scoring rules** (`app/domain/scoring.py`) | Every formula and threshold in one place, with no I/O. Scores each hazard 50/50 history and live, combines hazards (60% the worst, 40% the top three), then blends in the wildfire model (80/20). Also turns the model's weekly probability into a 0-100 score on a log scale | **Yes:** new 40/40/20 weights, the model score, and the overall blend. If the model is missing, the overall score uses the hazards alone |
| **Snapshot** (`app/services/snapshot.py`) | Every minute, computes scores for all 3,221 counties and every state from the nationwide feeds and the model. This is what the map shows | **Yes:** adds the model's county and state scores; labels alerts that came from the archive |
| **Risk service** (`app/services/risk.py`) | Builds the responses the website asks for: a state, a county (adding that county's own forecast and river gauges), or map values | **Yes:** new `wildfireModel` field on counties and states; falls back to the alert archive when NWS fails |
| **Wildfire model reader** (`app/services/wildfire_model.py`) | Reads the weekly scores file and checks every minute whether it changed. Ignores it once it's more than 13 days past its week, so an old forecast is never shown as current | **New** |
| **Alert archive reader** (`app/services/alert_archive.py`) | Only used when the backend can't reach NWS. Reads the alerts from the Lambda's most recent run, if that run is recent enough, and the site labels them "as of HH:MM UTC" | **New** |
| **Health check** (`/api/health`) | Reports the state of every data source | **Yes:** now includes the model file (which week, how many counties, whether it's current) and whether the alert backup is in use |

## The weekly wildfire job

| Component | What it does |
|---|---|
| **Model** (`ml/wildfire/`) | The trained XGBoost model, its calibration, and the lookup tables it needs (county locations, fire history, normal weather for each place and week) |
| **`predict_week`** | Downloads 180 days of NASA POWER weather for ~1,900 locations, fills in the coming days from the Open-Meteo forecast, scores every county, and publishes the results. It takes about 30 minutes and is run by hand today |
| **`handler.py`** | The same job behind an AWS-style entry point, for when it moves to AWS |
| **`weekly_scores/`** | The only code the job and the backend share. It defines the results file's format, and where it's stored: a local file today, or an S3 object later through one setting (`WILDFIRE_MODEL_URI`) |

**Why the backend doesn't run the model itself:** the model needs large data science libraries and 30 minutes of downloads, which don't belong in a web server. Splitting them means the backend stays small and fast, the job can move to AWS without touching the backend, and if the job fails, the site keeps working on history and live conditions.

**Today on Railway:** the backend reads the results file from its deployed code, so a new week means running the job, committing the file, and pushing. Moving it to S3 removes that step. See [aws-step-by-step/07](aws-step-by-step/07-connecting-railway-to-s3.md).

## Supabase (Postgres)

Supabase holds two kinds of data: **reference data** the backend loads at startup, and the **alert archive** the Lambda writes.

| Table | What it holds | Written by | Read by | Changed? |
|---|---|---|---|---|
| `counties`, `states`, `hazards`, `county_hazard_baselines`, `state_hazard_declarations`, `reference_meta`, `nri_*` | Counties and their locations, disaster history since 2006, and FEMA's expected-loss estimates | The backend's build script (`init_db --refresh`) | The backend, once at startup | No. Still the source of truth. The Lambda no longer writes the FEMA tables |
| `nws_alert_archive` | Every county-level NWS alert for the past year: what, how severe, which counties, when. No raw responses, so a year fits the free plan (about 150-250 MB) | The Lambda | The backend, only when NWS is down; later, alert history on county pages | **New** |
| `archive_settings` | One row per archive: `retention_days` (365, editable in the Table Editor) and the Lambda's last successful run time | Created by the migration; the Lambda updates the run time | The Lambda (how much to keep); the backend (whether the backup is fresh) | **New** |
| `api_config` | The Lambda's NWS address and request headers | By hand | The Lambda | **Trimmed** to one row, `nws_alerts` |
| `weather_alerts`, `earthquakes`, `gauges`, `weather_observations`, `locations` | The old Lambda's raw data. Nothing read it | | | **Dropped** by the migration, after copying the past year of alerts into the new archive |

The migration is `backend/db/migrations/2026-11-26_nws_alert_archive.sql`. It hasn't been run yet. It must run right before the new Lambda is deployed, because the old Lambda writes to tables it drops.

## AWS

### Now: the alert archive Lambda

| Component | What it does | Settings that matter |
|---|---|---|
| **EventBridge Scheduler** | Starts the Lambda on a timer | Every **15 minutes** (currently hourly). Many tornado and thunderstorm warnings last under an hour, so hourly runs miss them |
| **Lambda** (`backend/aws/lambda_function.py`) | Fetches all active NWS alerts, keeps those that cover a county, saves them to `nws_alert_archive`, records the run time, and deletes alerts older than `retention_days` | 256 MB, 60 s timeout, one copy at a time, no VPC |
| **CloudWatch** | Keeps the Lambda's logs, and alarms if it keeps failing | Logs kept **30 days**. Each run writes one short summary line |

**What changed:** the Lambda used to collect five feeds (alerts, earthquakes, river gauges, weather for five cities, FEMA's risk index) that nothing used, and its FEMA task overwrote tables the backend owns. Now it does one thing the backend can't do itself: build a history of alerts, since NWS only shows what's active right now.

**Not deployed yet.** The new code is on the branch; the hourly old version is still running.

### Planned: the weekly wildfire pipeline

The weekly job doesn't fit in one Lambda: its 1,900 downloads take about 30 minutes at a rate NASA POWER accepts, and Lambda stops after 15. The plan splits it into steps run by **Step Functions**:

| Step | Component | Output |
|---|---|---|
| Trigger | EventBridge Scheduler, Mondays 06:00 UTC | |
| 1. Download weather | Lambda, in 8 chunks, one at a time (this keeps the request rate safe) | Raw weather in S3 |
| 2. Forecast + features | Lambda | The model's input table in S3 |
| 3. Run the model | SageMaker Batch Transform, or simply a Lambda (the model takes under a second) | Raw predictions in S3 |
| 4. Calibrate + publish | Lambda | `wildfire/latest.json` in S3, which the backend reads |
| On failure | SNS email | |

A simpler alternative is running the existing job unchanged in one container on **ECS Fargate**, which has no time limit. Full details, settings and costs (under $0.50 a month) are in [aws-step-by-step/](aws-step-by-step/README.md).

## Frontend, briefly

The website (Next.js on Vercel) only changed what it shows:

- A **Wildfire Model · 20% of Score** section in the county and state panels.
- The 40/40/20 explanation and slider on the About page, with FEMA's own rating shown separately and labelled as not part of our score.
- Accurate data source cards and live-signal thresholds on the About page.

Its weights come from `frontend/lib/scoring.ts`, which mirrors the backend's.

## Status at a glance

| Piece | Status |
|---|---|
| 40/40/20 scoring, model reader, alert fallback (backend) | Done, pushed on `feature/add-model-scoring`. Live on Railway once merged to `main` |
| Weekly scores file | This week's is committed. Run by hand weekly until automated |
| Supabase migration | Written, not run |
| Alert archive Lambda | Written and tested offline, not deployed |
| S3 hand-off between job and backend | Code ready; bucket and credentials not set up |
| Weekly wildfire pipeline on AWS | Designed; step code not written |

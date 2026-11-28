# Risk Resource wildfire model: design, pipeline and operations

Audience: developers and coding agents working on the wildfire model, its weekly AWS pipeline, or how the API uses its scores.

Last checked against the code on 2026-11-27. If this doc and the code disagree, the code wins, and this doc should be updated.

Related docs:

- [`backend/ml/wildfire/README.md`](../backend/ml/wildfire/README.md): the model's training code, features, splits and full results tables.
- [`backend-doc.md`](backend-doc.md#wildfire-model-0-to-100): how the API turns the model's output into 20% of the overall score.
- [`apis-usage.md`](apis-usage.md#wildfire-model-weekly-job): exactly how NASA POWER and Open-Meteo are called each week.

## 1. Summary

The wildfire model gives, for every US county and week, the **probability that a large wildfire starts in that county that week**. It's an XGBoost classifier with isotonic calibration, trained on 2010 to 2020 and tested on 2021 to 2024.

It reaches the website in three steps:

1. **Every Monday at 06:00 UTC**, an AWS Step Functions pipeline downloads the weather, builds the model's features, runs the model and publishes one JSON file of probabilities to S3.
2. **The API reads that file** (`WILDFIRE_MODEL_URI`) and turns each probability into a 0 to 100 score on a log scale.
3. **That score is 20% of each county's overall risk score.** The other 80% is the historical and live hazard scores. A state's model score is the population-weighted average of its counties'.

The API never runs the model and doesn't install its dependencies. The model code and the API share only [`backend/weekly_scores/`](../backend/weekly_scores/__init__.py), the file format.

```
EventBridge Scheduler (Mon 06:00 UTC)
  └─▶ Step Functions: wildfire_state_machine.json
        1. DownloadWeather    Map over 8 chunks, one at a time ─▶ wildfire-fetch-chunk     ─▶ S3 raw/
        2. BuildFeatures      ─▶ wildfire-build-features                                   ─▶ S3 features/
        3. CalibrateAndPublish ─▶ wildfire-calibrate-publish                               ─▶ S3 wildfire/latest.json
                                                                                                 │
FastAPI on Railway ◀── re-reads when the S3 ETag changes ────────────────────────────────────────┘
```

## 2. What it predicts

| | |
|---|---|
| Unit | One county (3,221) for one week, Monday to Sunday |
| Target | A large wildfire starts in the county that week |
| "Large" | Mapped by [MTBS](https://www.mtbs.gov/): about 1,000+ acres in the West, 500+ in the East. Prescribed burns are excluded |
| Output | A calibrated probability, 0 to 1. A typical county-week is well under 1% |

**Why large fires only.** NIFC's incident feeds include small fires, but their yearly counts jump about fourfold from 2020 as more agencies started reporting to them. Training before 2020 and testing after it would mostly measure that reporting change. MTBS maps fires from satellite imagery with the same method since 1984, so its counts are comparable across years. Large fires are also the ones that threaten homes.

## 3. Data

| Data | Source | Used for |
|---|---|---|
| Fire ignitions | MTBS fire occurrence points, via the USFS EDW ArcGIS service | Training labels, and each county's fire history |
| Daily weather | [NASA POWER](https://power.larc.nasa.gov/) daily point API (MERRA-2 reanalysis), one request per 0.5° × 0.625° grid cell, about 1,895 cells | Training and every weekly run |
| Forecast weather | [Open-Meteo](https://open-meteo.com/) forecast API | Weekly runs only: the days NASA POWER hasn't published yet, including the week being scored |
| Counties | `backend/data/reference.json` and the Plotly county GeoJSON | Centroids, populations and boundaries |
| Elevation | Open-Meteo elevation API | A static feature |

**Why NASA POWER.** Open-Meteo's historical API would need about 1.2 million weighted calls for 15 years of daily weather in every county, against a free limit of 10,000 a day. NASA POWER has no key and no daily quota. Its limit is about 100 requests a minute, so every caller sends 60.

## 4. Features

All feature code is in [`features.py`](../backend/ml/wildfire/features.py), which training and the weekly runs both use, so they can't drift apart.

| Group | Features |
|---|---|
| The week itself | Mean and max temperature, vapor pressure deficit (VPD), afternoon humidity, wind, precipitation, dry days |
| Before the week | 30 and 90 day precipitation, 30 day heat and VPD, 7 day soil wetness, days since 2.5 mm of rain |
| Anomalies | The week's values minus that grid cell's normal for the week of the year (normals from 2010 to 2018 only) |
| Fire history | Large fires per year in the county, within 50 km, within 100 km, and within 100 km in the same month. Only years before the row's own count |
| Static | Latitude, longitude, elevation, log area, log population density |
| Season | Week of the year, as sine and cosine |

The features need 180 days of weather before the week. At inference time the days before the week are observed (NASA POWER), and the week itself comes from Open-Meteo's forecast.

## 5. Training and evaluation

Split by year, so no week is in two sets, and nothing from a later year leaks into an earlier one:

| Step | Years |
|---|---|
| First fit | 2010 to 2017 |
| Early stopping (picks the number of trees, by PR-AUC) | 2018 |
| Final fit | 2010 to 2018 |
| Isotonic calibration | 2019 to 2020 |
| Test | 2021 to 2024 |

Fires are rare (about 0.2% of county-weeks), so fire rows are up-weighted with `scale_pos_weight` (414 in the final fit). That inflates the raw probabilities, which is why they're calibrated afterwards.

**Test results (2021 to 2024)**, against a baseline that predicts each county's 2010 to 2020 fire rate for that month:

| Metric | Model | Baseline |
|---|---|---|
| PR-AUC | **0.081** | 0.066 |
| ROC-AUC | **0.953** | 0.792 |
| Fires caught in the top 5% of county-weeks | **74%** | 59% |
| Fire rate in the top 1% of county-weeks | **7.7%** (36× the average) | 6.8% |

The model won three of the four test years; in 2022 fire history alone did better. A PR-AUC of 0.08 is typical here: which week a large fire starts depends heavily on chance (a lightning strike, a spark). The model's job is to rank risk, and most fires happen in the 5% of county-weeks it rates highest.

**What drives it** (mean absolute SHAP on the test years): fire history in and around the county, county size, then this week's humidity compared to normal, rain over the previous 30 and 90 days, VPD compared to normal, and days since rain. History and size set *where* fires are likely; weather sets *which weeks*.

The trained model was saved on 2026-11-21. Calibration tables, per-year results and charts are in the [model README](../backend/ml/wildfire/README.md#results) and its notebooks.

## 6. From probability to score

The published file holds probabilities. The API scores them on a log scale (`wildfire_model_score` in [`app/domain/scoring.py`](../backend/app/domain/scoring.py)), because a linear scale would put almost every county near 0:

| Weekly probability | Model score |
|---|---|
| 0.01% or less | 0 |
| 0.1% | 33 |
| 1% | 67 |
| 10% or more | 100 |

Then `overall = 80% hazard composite + 20% model score`. Because only wildfire has a model, the overall score has a deliberate wildfire lean. Individual hazard scores, including Wildfire's, don't include it.

The 10% ceiling also stops the calibrator's top step from being shown as certainty: isotonic regression set it to 100% from only 8 calibration rows.

**When there's no model score,** the overall score is the hazard composite alone, never the model counted as 0. That happens when:

- The file is more than `WILDFIRE_MODEL_MAX_AGE_DAYS` (13) days past its Monday, for example because a weekly run failed.
- A county is missing from the file, because it had no weather that week.
- The file can't be read. The API keeps the last good week until it goes stale.

## 7. The weekly AWS pipeline

The whole job takes about 30 minutes, almost all of it NASA POWER downloads at 60 a minute. That's over Lambda's 15-minute limit, so Step Functions splits it into three Lambdas. The model itself runs in under a second for every county, so there's no SageMaker.

| AWS resource | Name / setting |
|---|---|
| Schedule | EventBridge Scheduler, `cron(0 6 ? * MON *)`, input `{"chunks": [0,1,2,3,4,5,6,7]}` |
| State machine | [`backend/aws/wildfire_state_machine.json`](../backend/aws/wildfire_state_machine.json) |
| Lambdas | `wildfire-fetch-chunk`, `wildfire-build-features`, `wildfire-calibrate-publish`, all from one container image |
| Code | [`backend/aws/wildfire_steps.py`](../backend/aws/wildfire_steps.py): `fetch_chunk`, `build_features`, `calibrate_and_publish` |
| Image | [`backend/aws/wildfire.Dockerfile`](../backend/aws/wildfire.Dockerfile), pushed to ECR as `riskresource-wildfire`. Each Lambda sets its handler with a CMD override |
| Bucket | `riskresource-data-bucket` (`WILDFIRE_BUCKET`) |
| Logs | CloudWatch Logs, one log group per Lambda |

### Steps

| Step | What it does | Retries |
|---|---|---|
| **1. DownloadWeather** | A Map state runs `fetch_chunk` for each of 8 slices of the grid cells, one at a time. Each saves a parquet file per cell to S3 and skips cells already there, so a retry resumes where it stopped | `Throttled` (NASA POWER 429): wait 60 s, doubling, up to 5 times. `ChunkIncomplete` (ran out of time, or more than 5% of cells failed): 10 s, up to 4 times. Lambda errors: 30 s, doubling, up to 3 times |
| **2. BuildFeatures** | Reads every cell's weather, fetches the Open-Meteo forecast for the missing days, builds one feature row per county and writes it to S3 | Any error: 120 s, doubling, up to 2 times |
| **3. CalibrateAndPublish** | Runs the model, calibrates, and publishes the week's file | Any error: 60 s, doubling, up to 3 times |

Every step works out the week from the execution's start time, never from the clock when it runs, so every retry agrees on the week and the date range even hours later.

### S3 layout

```
raw/{week}/power_{start}_{end}/{cell}.parquet   Weather downloads (deleted after 14 days)
features/{week}/features.csv                    Model input: no header, in the model's feature order
features/{week}/fips.json                       The county for each CSV row
wildfire/weeks/{week}.json                      Each week's published scores, kept as history
wildfire/latest.json                            What the API reads
```

### Lambda environment variables

| Variable | Default | Purpose |
|---|---|---|
| `WILDFIRE_BUCKET` | None, required | The pipeline's bucket |
| `WILDFIRE_MODEL_URI` | `s3://{bucket}/wildfire/latest.json` | Where step 3 publishes |
| `WILDFIRE_POWER_PER_MINUTE` | 60 | NASA POWER request pace |
| `WILDFIRE_POWER_WORKERS` | 3 | Concurrent NASA POWER requests |
| `WILDFIRE_CHUNK_MAX_FAILED` | 0.05 | Share of a chunk's cells allowed to fail before the chunk fails |

### Rebuilding the image

From `backend/` (the build needs `ml/` and `weekly_scores/`):

```bash
docker buildx build --platform linux/amd64 --provenance=false \
    -f aws/wildfire.Dockerfile -t <account>.dkr.ecr.<region>.amazonaws.com/riskresource-wildfire:latest .
docker push <account>.dkr.ecr.<region>.amazonaws.com/riskresource-wildfire:latest
```

Then, in the AWS console, point each of the three Lambdas at the new image. Changes to the state machine definition, the schedule or the Lambdas' environment variables are also made in the AWS console; nothing in AWS updates on push. The Dockerfile lives in `aws/` rather than `backend/` so Railway, which builds `backend/`, doesn't detect it and change how it deploys the API.

## 8. The published file

Defined in [`weekly_scores/contract.py`](../backend/weekly_scores/contract.py):

```json
{
  "schemaVersion": 1,
  "weekStart": "2026-11-23",
  "generatedAt": "2026-11-23T06:31:02+00:00",
  "modelTrainedAt": "2026-11-21T19:17:50+00:00",
  "probabilities": { "06065": 0.00142, "...": 0 }
}
```

It holds probabilities, not scores, so the scoring rule can change in the API without rerunning the pipeline. Change the format only by adding optional fields, or by bumping `schemaVersion` and teaching `from_json` to read the old version, because the pipeline and the API deploy separately.

The API reads it through `weekly_scores/store.py`, which handles both local paths and `s3://` URIs. It checks the file's version (a local file's modified time, an S3 object's ETag) at every snapshot rebuild, once a minute, so a new week appears without a restart. On Railway, the API reads it as a dedicated IAM user with read-only access to the bucket's `wildfire/` prefix.

The home page's animated map uses a fixed copy instead: `backend/data/snapshot/wildfire-<week>-snapshot.json`, in the same format, so its colors don't change from week to week.

## 9. Running it locally

From `backend/`, with the ML dependencies installed (`pip install -r requirements.txt -r requirements-ml.txt`):

| Command | What it does | Time |
|---|---|---|
| `python -m ml.wildfire.predict_week` | Scores this week, the same way as the pipeline, and publishes to `WILDFIRE_MODEL_URI` (default `backend/data/wildfire_model.json`, git-ignored) | About 30 minutes |
| `python -m ml.wildfire.predict_week --week 2026-11-23` | Scores a specific Monday | Same |
| `python -m ml.wildfire.build_dataset` | Downloads the training data and builds the training table | 5 to 30 minutes the first time, then cached |
| `python -m ml.wildfire.train` | Trains, calibrates, evaluates and rewrites `artifacts/` | A few minutes |

Downloads are cached under `backend/ml/wildfire/data/` (git-ignored), so a rerun only fetches what's missing. Point a local API at the local file by leaving `WILDFIRE_MODEL_URI` unset.

[`ml/wildfire/handler.py`](../backend/ml/wildfire/handler.py) runs the whole job in one call, for a container service with no time limit such as ECS Fargate. Production doesn't use it.

## 10. Checking on it

- **`GET /api/health`** on the API shows `sources.wildfireModel`: `available`, `weekStart`, `generatedAt`, how many `counties` it covers, `location` and the last `error`. `available: false` means the overall score is currently the hazard composite alone.
- **Step Functions console:** each Monday's execution and which step failed.
- **CloudWatch Logs:** each step logs a JSON summary line ("Chunk summary", "Features summary", "Publish summary") with its counts.
- **S3:** `wildfire/weeks/` has one file per successful week.

If a Monday run fails, rerun the execution from the Step Functions console with the same input. Downloads already in S3 are skipped. The API keeps using the previous week for up to 13 days.

## 11. Retraining

1. Run `build_dataset` and `train` (section 9). `train` rewrites everything in `artifacts/`.
2. Check the new numbers in `artifacts/metadata.json` against the table in section 5, and rerun the notebooks if you want updated charts.
3. Commit `artifacts/`, rebuild and push the container image (section 7), and update the Lambdas.

Keep `xgboost` at the same version in `requirements-ml.txt` and `aws/requirements-pipeline.txt`: the model file is saved with it.

MTBS publishes a year's fires about a year late, so 2025 isn't usable yet. Adding 2025 later means moving the test years along too, or the test set stops being unseen.

## 12. Known limitations

- **Forecast weather.** The model learned from NASA POWER reanalysis, but each week's own days come from Open-Meteo's forecast, which has different biases, especially for wind and humidity. The live scores haven't been checked against where fires actually started.
- **It overestimates at the top.** Above about 0.3%, calibrated probabilities were about a quarter too high in 2021 to 2024. The calibrator was fit on 2019 to 2020, and conditions have drifted since. Refitting only the calibrator on recent years would help, without touching the trees.
- **Large fires only.** A county with frequent small fires but no large ones scores low.
- **One weather point per grid cell.** Counties that share a cell share its weather.
- **Fire history stops at 2024,** the last full MTBS year in the artifacts.

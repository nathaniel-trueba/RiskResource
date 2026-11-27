# 3. Pipeline 2: the weekly wildfire scores, design

## What the job has to do

Once a week, for the week starting Monday:

1. **Download weather history.** NASA POWER, about 187 days of daily weather for each of ~1,895 grid cells. One request per cell.
2. **Download the forecast.** Open-Meteo, the days NASA hasn't published yet (the last few days and the rest of the week). About 38 requests of 50 cells each.
3. **Build features.** Turn the daily weather into 36 numbers per county (rain over 30 and 90 days, days since rain, this week's heat, and so on).
4. **Run the model.** XGBoost on 3,221 rows.
5. **Calibrate.** Turn the model's raw scores into real probabilities (`calibration.json`).
6. **Publish.** Write one small JSON file the backend reads.

Today `python -m ml.wildfire.predict_week` does all six in one go, in about 30 minutes, almost all of it step 1.

## The problem: rate limits vs Lambda's 15 minutes

- **NASA POWER** starts refusing requests (HTTP 429, "too many requests") above roughly 100 a minute. At a safe 60 a minute, 1,895 requests take **about 32 minutes**. Even at the limit it's 19.
- **Lambda** stops any single run after **15 minutes**, no exceptions.
- So step 1 can't run as one Lambda. It has to be split into pieces that each finish in a few minutes, and **something has to make sure the pieces don't run all at once**, or together they'd blow through the rate limit.

Open-Meteo has its own limits (600 calls a minute and 10,000 a day on the free tier, where one 50-location request counts as about 75 calls). The job spaces those requests 8 seconds apart, about 5 minutes in total. That fits in one Lambda.

## The solution: a state machine

**AWS Step Functions** runs steps in order, waits for each to finish, retries the ones that fail, and shows every run as a diagram you can click through. It's the "conductor": the Lambdas do the work, Step Functions decides what runs when.

```
Start (from the Monday schedule)
  │
  ├─ Step 1: Map "DownloadWeather"     8 chunks of ~237 cells, at most 1-2 at a time
  │     └─ Lambda fetch_chunk          → s3://bucket/raw/{week}/power/{cell}.parquet
  │
  ├─ Step 2: Lambda build_features     Open-Meteo forecast + features
  │                                    → s3://bucket/features/{week}/features.csv
  │
  ├─ Step 3: Lambda calibrate_and_publish   runs the model, calibrates, publishes
  │                                    → s3://bucket/wildfire/latest.json
  │                                    → s3://bucket/wildfire/weeks/{week}.json
  │
  └─ On any failure: the run fails (red in the Step Functions console)
```

How this beats the rate limit:

- **Small chunks.** ~237 cells at 60 a minute is about 4 minutes per Lambda, well inside 15.
- **The Map's `MaxConcurrency` caps how many chunks run at once.** Each chunk already spaces its own requests to 60 a minute, so 1 at a time means 60 a minute overall, and 2 means 120 (probably too many for POWER). Start with **1**: 8 chunks × 4 minutes is about 32 minutes in total, which is fine for a weekly job.
- **Retries happen in Step Functions, not in the code.** When POWER says "slow down", the chunk Lambda should give up immediately and report a `Throttled` error. Step Functions waits (60 seconds, then 120, then 240) and runs the chunk again. If the code waited instead, those waits would eat the 15 minutes.
- **Downloads are saved to S3 as they arrive, and skipped if already there.** A retried chunk only fetches what's missing, so a retry costs minutes, not the whole chunk again.

## Why not just chain everything with S3 events?

You could: S3 "file created" triggers a Lambda, whose output file triggers the next Lambda, and so on. It works for a simple line of steps, but:

- **"All 1,895 downloads are done" isn't an event.** S3 fires once per file, so you'd get 1,895 triggers and need your own counter to know when the last one landed.
- **Retries and failures get scattered** across separate Lambdas and event rules, with no single place to see "this week's run failed at step 2".
- **The rate limit is hard to enforce** when each event starts its own Lambda.

Step Functions handles the waiting, counting, retrying and failure reporting in one place. EventBridge is still used, just as the trigger that starts it.

## Week and file naming

- Every step receives the run's start time (`$$.Execution.StartTime`, see 05) and works out the week's Monday from it, the same way `current_week_start` does today. Every step therefore agrees on the week without being told.
- All S3 paths include the week (`2026-11-30`), so weeks never overwrite each other's intermediate files. Only `wildfire/latest.json` is overwritten, which is the point.

## The code

All three Lambda handlers are in **`backend/aws/wildfire_steps.py`**, written and tested offline. They reuse the existing model code (`ml/wildfire/`) rather than copying it, so the local `predict_week` job and the AWS pipeline can't drift apart. In the offline test, the pipeline's published scores matched `predict_week`'s exactly for the same week.

| Handler | Input (event) | What it does | Returns | Errors it raises on purpose |
|---|---|---|---|---|
| `fetch_chunk` | `{"chunk": 3, "of": 8, "startTime": ...}` | Takes its slice of the ~1,895 cells, skips cells already in S3, downloads the rest from NASA POWER (each request tried once, paced to `WILDFIRE_POWER_PER_MINUTE`), and saves each to `raw/{week}/power_{start}_{end}/{cell}.parquet`. Stops itself 90 seconds before Lambda's limit | `{"week", "chunk", "cells", "downloaded", "alreadyThere", "failed"}` | `Throttled` on a 429. `ChunkIncomplete` if it ran out of time, or more than 5% of its cells failed. Either way, what it saved is kept |
| `build_features` | `{"startTime": ...}` | Reads every downloaded cell from S3, fetches the Open-Meteo forecast (8 seconds between requests), builds the 36 features per county, and writes `features/{week}/features.csv` (no header, model column order) and `features/{week}/fips.json` (the county for each row) | `{"week", "featuresUri", "fipsUri", "counties", "dropped"}` | `ValueError` if no county has weather for the week |
| `calibrate_and_publish` | `{"week": "2026-11-30"}` | Runs the model on the features (under a second), calibrates, and publishes `wildfire/weeks/{week}.json`, then `wildfire/latest.json` | `{"week", "counties", "medianProbabilityPct", "published", "weeklyCopy"}` | |

The only change outside `aws/`: `fetch_power_cell` in `ml/wildfire/sources.py` takes its retry settings as arguments now (`attempts`, `backoff`). The defaults are unchanged, so the local job behaves as before; the Lambda passes `attempts=1`.

**Why the date range is in the download folder name** (`power_{start}_{end}`): every step works out the week and the download range from the run's start time. A retry hours later still uses the same folder and skips what's there, while a different run day (with one more day of NASA data) uses a fresh folder.

Other files in `backend/aws/` for deploying it:

| File | What it is |
|---|---|
| `wildfire.Dockerfile` | The container recipe ([04](04-packaging.md)) |
| `wildfire.Dockerfile.dockerignore` | Keeps local data, the virtualenv and `.env` out of the image |
| `requirements-pipeline.txt` | The libraries the image needs (the ML ones without the notebook packages, plus boto3) |
| `wildfire_state_machine.json` | The Step Functions definition, ready to paste ([05](05-step-functions-and-scheduling.md)) |

## Simpler alternative: one container, no splitting

If the step-by-step pipeline is more than you need, **ECS Fargate** runs a container with no time limit. EventBridge Scheduler starts it every Monday, it runs `python -m ml.wildfire.predict_week --output s3://.../wildfire/latest.json` exactly as on your laptop (same request spacing, same patient retries), and exits. No code changes. The trade-off: one long run instead of resumable steps, so a failure at minute 28 starts over (though the local download cache helps within a run).

| | Step Functions + Lambdas | Fargate scheduled task |
|---|---|---|
| Code changes | The four pieces above | None |
| Survives a failure halfway | Yes, resumes from S3 | Starts over |
| Rate limit control | Map concurrency + retries | The script's own spacing |
| Visibility | Diagram per run | One log stream |
| AWS concepts to learn | Lambda, Step Functions, S3, IAM | ECS, Fargate, ECR, IAM, a VPC (the default one works) |
| Shows off "an AWS ML pipeline" | More | Less |

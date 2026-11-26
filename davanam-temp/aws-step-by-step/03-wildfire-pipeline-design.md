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
  ├─ Step 3: Inference                 SageMaker Batch Transform (06), or a Lambda
  │                                    → s3://bucket/predictions/{week}/
  │
  ├─ Step 4: Lambda calibrate_and_publish
  │                                    → s3://bucket/wildfire/latest.json
  │                                    → s3://bucket/wildfire/weeks/{week}.json
  │
  └─ On any failure: email via SNS
```

How this beats the rate limit:

- **Small chunks.** ~237 cells at 60 a minute is about 4 minutes per Lambda, well inside 15.
- **The Map's `MaxConcurrency` caps how many chunks run at once.** Each chunk already spaces its own requests to 60 a minute, so 1 at a time means 60 a minute overall, and 2 means 120 (probably too many for POWER). Start with **1**: 8 chunks × 4 minutes is about 32 minutes in total, which is fine for a weekly job.
- **Retries happen in Step Functions, not in the code.** When POWER says "slow down", the chunk Lambda should give up immediately and report a `Throttled` error. Step Functions waits (60 seconds, then 120, then 240) and runs the chunk again. If the code waited instead, those waits would eat the 15 minutes.
- **Downloads are saved to S3 as they arrive, and skipped if already there.** A retried chunk only fetches what's missing, so a retry costs minutes, not the whole chunk again.

## Why not just chain everything with S3 events?

You could: S3 "file created" triggers a Lambda, which starts SageMaker, whose "job finished" event triggers another Lambda. It works for a simple line of steps, but:

- **"All 1,895 downloads are done" isn't an event.** S3 fires once per file, so you'd get 1,895 triggers and need your own counter to know when the last one landed.
- **Retries and failures get scattered** across separate Lambdas and event rules, with no single place to see "this week's run failed at step 2".
- **The rate limit is hard to enforce** when each event starts its own Lambda.

Step Functions handles the waiting, counting, retrying and failure alerts in one place. EventBridge is still used, just as the trigger that starts it.

## Week and file naming

- Every step receives the run's start time (`$$.Execution.StartTime`, see 05) and works out the week's Monday from it, the same way `current_week_start` does today. Every step therefore agrees on the week without being told.
- All S3 paths include the week (`2026-11-30`), so weeks never overwrite each other's intermediate files. Only `wildfire/latest.json` is overwritten, which is the point.

## Code that still needs writing

The scoring logic, the file format and the backend don't change. What's missing is splitting `predict_week.py` into the pieces above:

| Piece | What to add | Builds on |
|---|---|---|
| `fetch_chunk` handler | Take `{"chunk": 3, "of": 8, "startTime": ...}`, pick that slice of cells, download only those not already in S3, and on a 429 raise `Throttled` instead of waiting | `fetch_power`, `sources.fetch_power_cell` (with `attempts=1`) |
| S3 download cache | Read and write `raw/{week}/power/{cell}.parquet` instead of the local `data/live/` folder | `fetch_power`'s cache logic |
| `build_features` handler | Read all cells from S3, fetch the forecast, build features, write a CSV with **no header and columns in the model's feature order** (that's what SageMaker's XGBoost container expects), plus a separate file listing the county codes in the same row order | `fetch_forecast`, `wide_daily`, `WildfireModel.features_for_week` |
| `calibrate_and_publish` handler | Read the raw predictions, apply `calibrate()`, attach the county codes, build a `WeeklyScores`, and `publish()` it to `latest.json` and `weeks/{week}.json` | `WildfireModel.calibrate`, `WeeklyScores`, `publish` |
| (If skipping SageMaker) inference in `calibrate_and_publish` | Load `model.json`, `predict()`, then the same as above | `WildfireModel.predict` |

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

# 2. The weekly wildfire job on AWS

## Where it is now

`python -m ml.wildfire.predict_week`, run by hand. It takes about 30 minutes, almost all of it ~1,900 NASA POWER downloads, and writes `backend/data/wildfire_model.json`. If nobody runs it, the API stops using the model 13 days after the file's Monday and quietly scores hazards alone.

The code is already split for the move:

- `score_week()` fetches and scores, with no output I/O. `publish()` writes to a store. Neither cares where it runs.
- `weekly_scores/` is the only thing the job and the API share: the document format and the store (local file or `s3://`).
- `ml/wildfire/handler.py` has a `lambda_handler` that takes EventBridge events.
- Changing where results go is one setting, `WILDFIRE_MODEL_URI`, on both the job and the API.

(Bedrock isn't the right service for this: it hosts foundation models, not an XGBoost booster.)

## Recommended: ECS Fargate, triggered by EventBridge Scheduler

1. Build a container image from `backend/` with `requirements-ml.txt` plus `boto3`, and push it to ECR.
2. Create a Fargate task definition (0.5 vCPU, 2 GB is plenty) whose command is `python -m ml.wildfire.predict_week`, with `WILDFIRE_MODEL_URI=s3://<bucket>/wildfire/latest.json`.
3. Schedule it with EventBridge Scheduler, for example `cron(0 6 ? * MON *)`: Monday 06:00 UTC, off-peak for the APIs it calls.
4. The task role needs `s3:PutObject` on that key. The API's role (or keys) needs `s3:GetObject`.
5. Point the API's `WILDFIRE_MODEL_URI` at the same S3 key, and add `boto3` to `requirements.txt`.

Why Fargate: there's no time limit, so the existing request spacing and patient retries work unchanged. A 30-minute weekly run costs well under a dollar a month.

## If it has to be Lambda

Lambda's 15-minute limit is the problem. NASA POWER starts refusing requests (HTTP 429) above roughly 100 a minute, so ~1,900 requests take at least 19 minutes even at full speed. To fit:

1. **Shard the downloads.** Add a way to download one chunk of cells (for example `--cells 0:250`) and run chunks from a Step Functions Map state. About 250 cells at 60 a minute is ~4 minutes per chunk.
2. **Control the rate from the outside.** Set the Map state's `MaxConcurrency` to 1 or 2. Each worker already spaces its own requests, so concurrency sets the overall rate.
3. **Let Step Functions retry, not the code.** On a 429 the worker should fail fast. Give the task a Retry block (60-second interval, backoff rate 2, 5 attempts). The script's own 60-second backoff would eat the 15 minutes.
4. **Cache downloads in S3, not `/tmp`.** `/tmp` disappears between invocations, and S3 lets a retried chunk skip cells it already has. This needs an S3-backed version of the cache in `fetch_power`.
5. **A final step** loads all chunks, fetches the Open-Meteo forecast (~38 requests, 8 seconds apart, ~5 minutes), scores and publishes.

## Settings that matter either way

- **One run at a time.** The Map's `MaxConcurrency: 1` and no manual run during a scheduled one (Lambda; reserved concurrency can't be set on a new account's limit of 10), or a single scheduled task (Fargate). Two overlapping runs double the request rate and trigger 429s.
- **The request rate as configuration.** Expose `per_minute` and `workers` through environment variables (today they're command-line flags, and the handler uses the defaults), so you can slow down without a redeploy.
- **Open-Meteo shares a budget with the API.** The job uses ~2,000-3,000 of Open-Meteo's 10,000 free daily calls, and the API's per-county forecasts use the rest. Run the job early Monday UTC, and keep the 8-second spacing (`FORECAST_INTERVAL_SECONDS`).
- **A failure alarm (not built; left out of the current setup).** A CloudWatch alarm on task or state-machine failures, emailed through SNS. Without it, a missed week shows up only as a red run in the console or a stale week in `/api/health`.
- **A freshness alarm.** Separately, alarm if the S3 object is older than 8 days. That catches a schedule that silently stopped.
- **Fewer, cheaper requests.** Most of the 180 days don't change week to week. Keep the previous week's downloads in S3 and fetch only the days since (plus a few days, because POWER revises recent days). That doesn't reduce the number of requests, but each one is much smaller and faster. Also check whether POWER's regional endpoint could fetch many cells per request.

## Retraining

Fire history in the artifacts stops at 2024 (MTBS publishes about a year late). Once a year, when MTBS adds the previous year, rerun `build_dataset` and `train`, review the metrics in `artifacts/metadata.json` against the last run, then ship the new artifacts with the job's image. Keep old artifacts versioned in S3 so you can roll back.

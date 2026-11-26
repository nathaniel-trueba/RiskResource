# AWS step by step

How to run Risk Resource's two scheduled jobs on AWS, with the exact settings for each piece, and why each setting is what it is. Written for someone who knows what the AWS services are but hasn't wired them together before.

## The two pipelines

**1. The NWS alert archive (small, already mostly built).** Every 15 minutes, a Lambda copies active National Weather Service alerts into Supabase and deletes alerts older than a year. It gives the site a history of alerts, and a backup copy when NWS is unreachable.

```
EventBridge Scheduler (every 15 min) ──▶ Lambda ──▶ NWS API
                                           │
                                           ▼
                                  Supabase (1-year archive)
```

**2. The weekly wildfire scores (bigger, needs building).** Every Monday, download weather for ~1,900 locations, run the wildfire model for 3,221 counties, and publish one small file that the Railway backend reads.

```
EventBridge Scheduler (Mondays 06:00 UTC)
        │
        ▼
Step Functions state machine
  1. Download weather in chunks (Lambda × ~8, one or two at a time)  ──▶ S3 raw/
  2. Forecast + features (Lambda)                                    ──▶ S3 features/
  3. Model inference (SageMaker Batch Transform, or a Lambda)        ──▶ S3 predictions/
  4. Calibrate + publish (Lambda)                                    ──▶ S3 wildfire/latest.json
        │
        ▼
Railway backend reads s3://.../wildfire/latest.json
```

## Read in this order

| File | What's in it |
|---|---|
| [01-aws-basics-and-setup.md](01-aws-basics-and-setup.md) | One-time setup: region, IAM users vs roles, the AWS CLI, the S3 bucket, secrets, an email alert topic, a budget |
| [02-alert-archive-lambda.md](02-alert-archive-lambda.md) | Pipeline 1 end to end: migration, packaging, Lambda settings, the 15-minute schedule, retention, verifying |
| [03-wildfire-pipeline-design.md](03-wildfire-pipeline-design.md) | Pipeline 2's design: why it's split into steps, the rate-limit problem, S3 layout, the code that still needs writing |
| [04-packaging.md](04-packaging.md) | Getting Python code with big libraries into Lambda: zip files vs container images, Docker, ECR |
| [05-step-functions-and-scheduling.md](05-step-functions-and-scheduling.md) | The state machine for pipeline 2, every setting explained, and the weekly schedule |
| [06-sagemaker-or-not.md](06-sagemaker-or-not.md) | What Batch Transform is, why it's probably overkill here, and how to set it up if you use it anyway |
| [07-connecting-railway-to-s3.md](07-connecting-railway-to-s3.md) | Letting the Railway backend read the published file |
| [08-logs-retention-monitoring-costs.md](08-logs-retention-monitoring-costs.md) | Keeping logs and stored data to a fixed window, alarms, and what it all costs |

## Build order

1. **01** once.
2. **02**, the alert archive. It's small and nearly done, and it's good practice for the bigger one.
3. **03**, then **04** and **05**, for the wildfire pipeline. Decide on SageMaker with **06** before building step 3.
4. **07**, to switch the backend from the committed file to S3.
5. **08**, as you go: set log retention and alarms for each piece when you create it.

## Words used throughout

- **Region:** the AWS data centre area everything lives in. Pick one and use it for everything (01).
- **IAM role:** a set of permissions that an AWS service *assumes* while it runs (a Lambda, a state machine). Nothing logs in as a role.
- **IAM user + access keys:** a long-lived identity for something *outside* AWS (your laptop, Railway). Keys are like a password: never commit them.
- **ARN:** an AWS resource's full ID, like `arn:aws:s3:::riskresource-data`. Permissions refer to resources by ARN.
- **Execution:** one run of a state machine. **Invocation:** one run of a Lambda.
- **Log group:** where one Lambda's (or state machine's) logs go in CloudWatch, for example `/aws/lambda/nws-alert-archive`.

## What's built vs not

| Piece | Status |
|---|---|
| Alert archive Lambda code, schema, migration | Written and tested offline. Not deployed |
| Backend reading from S3 (`WILDFIRE_MODEL_URI=s3://...`) | Written. Not tested against real S3 |
| `ml/wildfire/handler.py` (one-shot job entry point) | Written. Works on a container service (Fargate), not on Lambda (it runs ~30 min) |
| Chunked downloads, S3 download cache, features export, calibrate-and-publish Lambda | **Not written.** Listed in 03 |
| Everything in AWS (bucket, roles, functions, schedules, state machine) | **Not created** |

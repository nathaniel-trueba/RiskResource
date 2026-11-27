# 4. Packaging: the wildfire Lambdas as a container image

**What you'll end up with:** one Docker image in ECR, and three Lambda functions that all run from it, each calling a different function in `wildfire_steps.py`.

```
Your laptop                        AWS
───────────                        ───
backend/ code ──docker build──▶ image ──docker push──▶ ECR repository "riskresource-wildfire"
                                                           │
                                         Lambda reads the image when you create/update a function
                                                           ▼
                                   wildfire-fetch-chunk        (runs wildfire_steps.fetch_chunk)
                                   wildfire-build-features     (runs wildfire_steps.build_features)
                                   wildfire-calibrate-publish  (runs wildfire_steps.calibrate_and_publish)
```

**You don't write any code or Dockerfile in this guide.** Everything it builds from is already in the repo. Each step says where it happens:

- **Browser:** the AWS console.
- **Terminal:** PowerShell on your laptop, **in the `backend/` folder** (`cd C:\Users\<you>\DS3\RiskResource\backend`). The commands are PowerShell; the `$NAME = ...` lines set variables used by the lines after them, so run them in the same window.

## Background: what the image is for

Lambda runs your code in a small, short-lived virtual machine (a "micro-VM"). It has to get Python, the libraries and your code from somewhere:

- **Zip file** (the alert archive, [02](02-alert-archive-lambda.md)): AWS supplies the operating system and Python. Your zip adds the code and libraries on top. Limit: 250 MB unzipped.
- **Container image** (these Lambdas): you supply the whole filesystem: operating system, Python, libraries, code and model files. Limit: 10 GB.

The wildfire code needs pandas, numpy, scipy, pyarrow, scikit-learn and xgboost: several hundred MB, over the zip limit. So it's an image.

**Yes: ECR + Lambda is how the micro-VM gets everything installed.** The key points:

- **Everything is installed once, on your laptop, when you build the image** (`pip install` runs inside `docker build`). Nothing is installed when the Lambda is called.
- **ECR is just storage** for the finished image, like a private Docker Hub.
- **When you create or update the function, Lambda copies the image** from ECR and caches it. It records the image's exact version, so pushing a new image to ECR changes nothing until you update the function (step 8).
- **When the function is called,** Lambda starts a micro-VM whose disk *is* your image: Python and every library are already there. The first call after a while takes a few extra seconds ("cold start"). Later calls soon after reuse the same micro-VM, and the model loaded on the first call stays loaded.
- **The disk is read-only** except `/tmp`. This pipeline never writes files locally; it keeps everything in memory and S3.

## What's already in the repo

| File | What it is | Do you edit it? |
|---|---|---|
| `backend/aws/wildfire.Dockerfile` | The recipe for the image: start from AWS's Lambda Python 3.13 image, `pip install` the libraries, copy in `ml/`, `weekly_scores/` and `wildfire_steps.py` | No |
| `backend/aws/requirements-pipeline.txt` | The libraries the recipe installs | Only if versions change. Keep xgboost at the version the model was trained with (3.4.1) |
| `backend/aws/wildfire.Dockerfile.dockerignore` | What *not* to copy into the image: local data downloads (gigabytes), notebooks, `.venv/`, `.env`, the API code | No |
| `backend/aws/wildfire_steps.py` | The three Lambda handlers | No |

The model files (`ml/wildfire/artifacts/`, about 6 MB) go into the image with the code. Retraining the model means rebuilding the image.

The Dockerfile lives in `aws/`, not `backend/`, on purpose: Railway builds the API from `backend/`, and a file named `Dockerfile` there would change how Railway deploys it.

## Step 1: Check the prerequisites

**Terminal:**

```powershell
docker --version             # Docker is installed
docker info                  # Docker is running. If this errors, start Docker Desktop and wait for it
aws sts get-caller-identity  # The AWS CLI is set up (01). Prints your 12-digit account ID
```

Note the account ID; you need it in step 3.

## Step 2: Create the ECR repository (once)

**Browser:** ECR → Private registry → Repositories → **Create repository**.

| Setting | Value | Why |
|---|---|---|
| Visibility | Private | Only your account can pull it |
| Name | `riskresource-wildfire` | The commands below use this name |
| Image tag mutability | **Mutable** | Lets you push a new `latest` over the old one |
| Encryption | AES-256 (default) | Free |
| Scan on push | Off (optional) | Not needed here |

Then, in the new repository → **Lifecycle policy** → Create rule: **image count more than 3 → expire**. Each push leaves the previous image behind (about 1 GB each), and ECR charges for storage after the first year's free 500 MB. This keeps the last three, so you can still go back one or two versions.

## Step 3: Build the image

**Terminal, in `backend/`:**

```powershell
$ACCOUNT  = "123456789012"     # your account ID from step 1
$REGION   = "us-west-2"
$REGISTRY = "$ACCOUNT.dkr.ecr.$REGION.amazonaws.com"
$IMAGE    = "$REGISTRY/riskresource-wildfire:latest"

docker buildx build --platform linux/amd64 --provenance=false -f aws/wildfire.Dockerfile -t $IMAGE .
```

What each part means:

- **`-f aws/wildfire.Dockerfile`:** which recipe to use.
- **`.` at the end:** the build "context", the folder Docker may copy files from. It's `backend/` (where you are), because the recipe copies `ml/` and `weekly_scores/` from there. Running this from any other folder fails with "not found" errors.
- **`-t $IMAGE`:** names ("tags") the image with its ECR address, so `docker push` knows where it goes.
- **`--platform linux/amd64`:** builds for the Intel/AMD chips Lambda uses (x86_64). Needed on Apple Silicon Macs; harmless on Windows.
- **`--provenance=false`:** newer Docker adds metadata that Lambda rejects ("image manifest not supported").

The first build takes about 5 minutes (downloading the base image and libraries). Later builds reuse the library layer and take seconds if only code changed. Check the size: `docker images riskresource-wildfire`. Around 1-1.5 GB is expected.

## Step 4: Test the image on your laptop

**Terminal:** load the model inside the image, the same way the Lambda will:

```powershell
docker run --rm --entrypoint python $IMAGE -c "import wildfire_steps; m = wildfire_steps._load_model(); print('ok', len(m.features), 'features')"
```

It should print `ok 36 features`. If it fails here (a missing library, a file not copied), it would fail the same way in Lambda, and it's much quicker to find out here.

## Step 5: Push the image to ECR

**Terminal:**

```powershell
aws ecr get-login-password --region $REGION | docker login --username AWS --password-stdin $REGISTRY
docker push $IMAGE
```

- The first line gives Docker a 12-hour password for your ECR. Rerun it if a later push says "no basic auth credentials".
- The push uploads about 1 GB the first time, and only changed layers after that.

**Shortcut:** in the console, the repository's **View push commands** button shows these same commands with your account and region filled in.

**Check:** the repository in the browser now lists an image tagged `latest`.

## Step 6: Create the execution role (once, shared by all three)

The execution role is what the Lambdas are allowed to do while they run.

**Browser:** IAM → Roles → **Create role**:

1. Trusted entity: **AWS service** → **Lambda**.
2. Permissions: tick **`AWSLambdaBasicExecutionRole`** (writing logs).
3. Name: `wildfire-pipeline-lambda` → Create.
4. Open the role → Add permissions → **Create inline policy** → JSON → paste, replacing `<bucket>`:

   ```json
   {
     "Version": "2012-10-17",
     "Statement": [
       {
         "Effect": "Allow",
         "Action": ["s3:GetObject", "s3:PutObject"],
         "Resource": "arn:aws:s3:::<bucket>/*"
       },
       {
         "Effect": "Allow",
         "Action": "s3:ListBucket",
         "Resource": "arn:aws:s3:::<bucket>"
       }
     ]
   }
   ```

   Name it `wildfire-bucket-access`.

- **`GetObject` / `PutObject`:** read and write files in the bucket (weather downloads, features, the published scores).
- **`ListBucket`:** see which weather files already exist, so a retry skips them. Note the different `Resource`: listing applies to the bucket itself, reading and writing to the files in it (`/*`).

No ECR permission is needed: Lambda pulls the image with its own service permissions, as long as the image is in the same account.

## Step 7: Create the three Lambda functions

**Browser.** Do this three times, once per row of the table below.

1. Lambda → **Create function** → **Container image**.
2. **Function name:** from the table (it must match exactly; the state machine calls them by name).
3. **Container image URI:** Browse images → `riskresource-wildfire` → the `latest` image.
4. **Architecture:** x86_64.
5. **Permissions:** Change default execution role → **Use an existing role** → `wildfire-pipeline-lambda`.
6. **Create function.**
7. **Configuration → Image configuration → Edit → CMD override:** the value from the table. This picks which function in `wildfire_steps.py` this Lambda runs. Without it, all three would run `fetch_chunk`, the Dockerfile's default.
8. **Configuration → General configuration → Edit:** memory and timeout from the table. Leave ephemeral storage at 512 MB.
9. **Configuration → Environment variables → Edit:** add `WILDFIRE_BUCKET` = your bucket name.

| Function name | CMD override | Memory | Timeout |
|---|---|---|---|
| `wildfire-fetch-chunk` | `wildfire_steps.fetch_chunk` | 1024 MB | 15 min |
| `wildfire-build-features` | `wildfire_steps.build_features` | 3008 MB | 15 min |
| `wildfire-calibrate-publish` | `wildfire_steps.calibrate_and_publish` | 1024 MB | 5 min |

Why those numbers:

- **Memory also buys CPU.** Lambda gives CPU in proportion to memory. `build_features` holds all ~1,900 weather files in memory and does the heavy pandas work, so it gets 3 GB. You pay per GB-second, so a faster run at more memory costs about the same.
- **Timeouts:** 15 minutes is Lambda's maximum. `fetch_chunk` stops itself 90 seconds before its timeout and saves its progress, and Step Functions retries it. `calibrate_and_publish` takes seconds; 5 minutes is plenty.
- **Reserved concurrency:** leave it unset. New accounts can't reserve any (see [02](02-alert-archive-lambda.md)), and the state machine's `MaxConcurrency: 1` already runs one download at a time.

**Optional environment variables.** Each has a default in the code; set one only to change it, without rebuilding:

| Variable | Default | On | What it does |
|---|---|---|---|
| `WILDFIRE_MODEL_URI` | `s3://<bucket>/wildfire/latest.json` | calibrate-publish | Where to publish the scores |
| `WILDFIRE_POWER_PER_MINUTE` | `60` | fetch-chunk | NASA POWER requests per minute. Lower it if runs keep getting throttled |
| `WILDFIRE_POWER_WORKERS` | `3` | fetch-chunk | Requests in flight at once. The per-minute cap still applies |
| `WILDFIRE_CHUNK_MAX_FAILED` | `0.05` | fetch-chunk | Share of a chunk's cells allowed to fail (for reasons other than rate limits) before the chunk fails |

## Step 8: Test one function

**Browser:** `wildfire-fetch-chunk` → **Test** tab → new event:

```json
{ "chunk": 0, "of": 8 }
```

→ **Test**. It downloads one eighth of the weather (~237 locations), which takes about 4 minutes. Success looks like:

```json
{ "week": "2026-11-30", "chunk": 0, "cells": 237, "downloaded": 237, "alreadyThere": 0, "failed": 0 }
```

and S3 now has files under `raw/<week>/`. This checks everything at once: the image starts, the code finds the model, the role can write to the bucket, and NASA POWER answers.

| If it says | It means |
|---|---|
| `AccessDenied` on S3 | The inline policy's bucket name is wrong (step 6) |
| `KeyError: 'WILDFIRE_BUCKET'` | The environment variable is missing (step 7.9) |
| `Runtime.InvalidEntrypoint` or "exec format error" | The image was built without `--platform linux/amd64` (step 3) |
| `Task timed out after 3.00 seconds` | The timeout wasn't changed (step 7.8) |
| `ChunkIncomplete` | It ran out of time. Run the test again: it skips what's done and finishes |

Don't test the other two on their own. They need the outputs of the earlier steps, so test them with a full run of the state machine ([05](05-step-functions-and-scheduling.md)).

## Updating after a code or model change

Rebuild, test, push (steps 3-5), then point all three functions at the new image. **Terminal:**

```powershell
foreach ($fn in "wildfire-fetch-chunk", "wildfire-build-features", "wildfire-calibrate-publish") {
    aws lambda update-function-code --function-name $fn --image-uri $IMAGE
}
```

Or in the browser, per function: **Image → Deploy new image → `latest`** → Save. Until you do one of these, the functions keep running the old image, even though ECR has the new one.

## Settings summary

| Where | Setting | Value |
|---|---|---|
| ECR | Repository | `riskresource-wildfire`, private, mutable tags, keep the last 3 images |
| Build | Command | `docker buildx build --platform linux/amd64 --provenance=false -f aws/wildfire.Dockerfile -t <image> .`, from `backend/` |
| IAM | Execution role | `wildfire-pipeline-lambda`: `AWSLambdaBasicExecutionRole` + Get/Put on `<bucket>/*` + List on `<bucket>` |
| Lambda | All three | x86_64, the `latest` image, that role, `WILDFIRE_BUCKET`, 512 MB ephemeral storage, no reserved concurrency, no VPC |
| Lambda | `wildfire-fetch-chunk` | CMD `wildfire_steps.fetch_chunk`, 1024 MB, 15 min |
| Lambda | `wildfire-build-features` | CMD `wildfire_steps.build_features`, 3008 MB, 15 min |
| Lambda | `wildfire-calibrate-publish` | CMD `wildfire_steps.calibrate_and_publish`, 1024 MB, 5 min |

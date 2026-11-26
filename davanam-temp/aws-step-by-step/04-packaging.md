# 4. Packaging: getting the code into Lambda

## Zip file or container image?

Lambda accepts code two ways:

| | Zip file | Container image |
|---|---|---|
| Size limit | 50 MB uploaded, 250 MB unzipped | 10 GB |
| How you build it | `pip install --target` + zip | A Dockerfile + `docker build` |
| Where it's stored | Uploaded to Lambda (or S3) | Amazon ECR (AWS's Docker image registry) |
| Good for | Small functions with few dependencies | Data science libraries |

**The alert archive** only needs `psycopg`, a few MB, so it's a zip ([02](02-alert-archive-lambda.md)).

**The wildfire Lambdas** need pandas, numpy, pyarrow, scipy and xgboost. Together those are several hundred MB, over the 250 MB zip limit. So they're **container images**. That's not a workaround: it's the normal way to ship ML code to Lambda.

## What a container image is, briefly

A container image is a snapshot of a small Linux system with Python, your libraries and your code already installed. You describe it in a `Dockerfile`, build it once on your machine, upload it to ECR, and point the Lambda at it. Lambda then starts copies of that exact environment, so "works on my machine" really does mean it works on Lambda.

You need **Docker Desktop** installed to build images.

## One image, several functions

All the wildfire Lambdas (`fetch_chunk`, `build_features`, `calibrate_and_publish`) share the same libraries and code. Build **one image**, and create one Lambda per step from it, each with a different **handler** (the function to call). In the Lambda console that's "Image configuration → CMD override".

## The Dockerfile

Put this at `backend/Dockerfile.wildfire` (not created yet):

```dockerfile
# AWS's official Lambda base image for Python. It includes the Lambda runtime.
FROM public.ecr.aws/lambda/python:3.13

# Libraries first, so Docker can reuse this layer when only the code changes.
COPY requirements-ml.txt ${LAMBDA_TASK_ROOT}/
RUN pip install --no-cache-dir -r ${LAMBDA_TASK_ROOT}/requirements-ml.txt boto3

# The code the steps need. The API (app/) isn't included.
COPY ml/ ${LAMBDA_TASK_ROOT}/ml/
COPY weekly_scores/ ${LAMBDA_TASK_ROOT}/weekly_scores/

# Default handler. Each Lambda overrides this with its own.
CMD ["ml.wildfire.lambda_steps.fetch_chunk"]
```

Notes:

- **Trim `requirements-ml.txt` for the image.** It includes notebook packages (matplotlib, ipykernel, nbconvert) that the pipeline doesn't need. Make a `requirements-pipeline.txt` with just xgboost, scikit-learn, scipy, pandas, pyarrow and shapely, so the image is smaller and starts faster.
- **The model artifacts (`ml/wildfire/artifacts/`, about 6 MB) go inside the image** through `COPY ml/`. Retraining means rebuilding the image. That keeps the code and the model it was written for together.
- `ml/wildfire/data/` is git-ignored and huge locally. Add a `.dockerignore` with `ml/wildfire/data/` and `**/notebooks/` so it isn't copied in.
- `ml.wildfire.lambda_steps` is the module with the step handlers described in [03](03-wildfire-pipeline-design.md). It doesn't exist yet.

## Build and upload

One time: create the registry. ECR → Repositories → Create → **Private**, name `riskresource-wildfire`.

Each time the code or model changes, from `backend/`:

```bash
ACCOUNT=123456789012          # yours: aws sts get-caller-identity
REGION=us-east-1
REPO=$ACCOUNT.dkr.ecr.$REGION.amazonaws.com/riskresource-wildfire

# Let Docker push to your ECR
aws ecr get-login-password --region $REGION | docker login --username AWS --password-stdin $ACCOUNT.dkr.ecr.$REGION.amazonaws.com

# Build for Lambda's CPU type, in the format Lambda accepts
docker buildx build --platform linux/amd64 --provenance=false -f Dockerfile.wildfire -t $REPO:latest .

docker push $REPO:latest
```

Why those two flags:

- **`--platform linux/amd64`:** Lambda (x86_64) needs an image built for Intel/AMD chips. On an Apple Silicon Mac, Docker otherwise builds for ARM, and the Lambda fails to start with a confusing error.
- **`--provenance=false`:** newer Docker versions add extra metadata to images that Lambda doesn't accept ("image manifest not supported").

**Updating a Lambda after a push:** Lambda doesn't notice new images on its own. In the console: the function → Image → Deploy new image → pick `latest`. Or:

```bash
aws lambda update-function-code --function-name wildfire-fetch-chunk --image-uri $REPO:latest
```

Do that for each of the wildfire functions.

## Creating each Lambda from the image

Lambda → Create function → **Container image** → Browse images → `riskresource-wildfire:latest`. Then per function:

| Function | CMD override | Memory | Timeout | Ephemeral storage (`/tmp`) |
|---|---|---|---|---|
| `wildfire-fetch-chunk` | `ml.wildfire.lambda_steps.fetch_chunk` | 1024 MB | 15 min | 512 MB (default) |
| `wildfire-build-features` | `ml.wildfire.lambda_steps.build_features` | 3008 MB | 15 min | 2048 MB |
| `wildfire-calibrate-publish` | `ml.wildfire.lambda_steps.calibrate_and_publish` | 1024 MB | 5 min | 512 MB |

Why those numbers:

- **Memory also buys CPU.** Lambda gives more CPU in proportion to memory, so pandas work (`build_features`) runs much faster at 3 GB. You pay per GB-second, but a faster run costs about the same.
- **Timeouts at the 15-minute maximum** for the long steps, so a slow day doesn't kill a run that would have finished. Step Functions retries a timeout like any other error.
- **`/tmp` space:** `build_features` reads all ~1,900 downloaded cells. Give it room to stage files locally.

Environment variables, on all three:

| Variable | Value |
|---|---|
| `WILDFIRE_BUCKET` | Your bucket name |
| `WILDFIRE_MODEL_URI` | `s3://<bucket>/wildfire/latest.json` (used by `calibrate_and_publish`) |
| `WILDFIRE_POWER_PER_MINUTE` | `60` (used by `fetch_chunk`; lets you slow down without a redeploy) |

Execution role permissions (one role shared by all three is fine):

- The basic Lambda logging policy (`AWSLambdaBasicExecutionRole`).
- `s3:GetObject`, `s3:PutObject` on `arn:aws:s3:::<bucket>/*`.
- `s3:ListBucket` on `arn:aws:s3:::<bucket>`, so the code can check which cells are already downloaded.

**Reserved concurrency:** set **1** on `wildfire-fetch-chunk`. The Map's concurrency setting (05) already limits it, but this is a second lock: nothing, not even a manual test, can run two downloaders at once and double the request rate.

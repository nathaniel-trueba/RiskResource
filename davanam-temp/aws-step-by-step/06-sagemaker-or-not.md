# 6. SageMaker Batch Transform: use it or not?

## What it is

SageMaker is AWS's machine-learning service. **Batch Transform** is the part for "I have a trained model and a file of rows; give me a prediction for every row." You give it:

- a **model**: your saved model file plus a container image that knows how to load and run it,
- an **input location** in S3 (our features CSV),
- an **output location** in S3,
- an **instance type** (the size of computer to rent).

It starts a temporary computer, loads the model, runs every row through it, writes the predictions to S3, and shuts the computer down. You pay only while it runs.

## Why it's probably overkill for this project

**The inference is tiny.** 3,221 rows through XGBoost takes **well under a second** on any computer, including inside a Lambda. Batch Transform is built for millions of rows or large models. Here it would:

- **Spend 5 to 10 minutes starting a computer** to do under a second of work. That's most of the step's time.
- **Add moving parts:** a model package, a SageMaker model, an execution role, and container version issues (below), each something that can break.
- **Cost a few cents a week** (an `ml.m5.large` is roughly $0.10-0.15 an hour, billed per second). Cheap, but not free, where a Lambda doing the same is.

**The version problem (check this before committing to SageMaker).** The model was trained with **xgboost 3.4.1**. SageMaker's **built-in** XGBoost containers usually lag well behind the latest xgboost release, and an older xgboost may refuse to load a model saved by a newer one, or load it differently. Check the current list of built-in container versions in the SageMaker docs:

- If one matches 3.x, use it.
- If not, either build your **own** inference container with xgboost 3.4.1 ("bring your own container", which is more work), or retrain or re-save the model with a version SageMaker supports and re-check the test metrics.

**Calibration can't happen inside the built-in container.** It returns XGBoost's raw scores, and our isotonic calibration (`calibration.json`) has to be applied afterwards. That's why `calibrate_and_publish` exists either way.

## When it *would* make sense

- **For the presentation or your portfolio:** "an event-driven ML pipeline with Step Functions orchestrating SageMaker" is a real, recognizable AWS pattern, and you'll learn SageMaker by doing it.
- **If the model grows:** much finer grids than counties, hourly forecasts, or a much bigger model.
- **If you later use SageMaker for training** (SageMaker Training jobs, Model Registry), and want inference in the same place.

**Recommendation:** start without it (inference inside `calibrate_and_publish`). Add SageMaker later as a deliberate learning step. The state machine change is one extra state (05), so it's easy to add.

## If you do use it: setup

### 1. Package the model

SageMaker's XGBoost container looks for a file named **`xgboost-model`** inside a gzip'd tar archive.

```bash
cp ml/wildfire/artifacts/model.json xgboost-model
tar -czf model.tar.gz xgboost-model
aws s3 cp model.tar.gz s3://<bucket>/models/wildfire/<trained-date>/model.tar.gz
```

Keep each trained model in its own dated folder, so you can roll back.

### 2. A SageMaker execution role

IAM → Roles → Create role → trusted entity **SageMaker**. Permissions:

- `s3:GetObject` on `arn:aws:s3:::<bucket>/models/*` and `arn:aws:s3:::<bucket>/features/*`.
- `s3:PutObject` on `arn:aws:s3:::<bucket>/predictions/*`.
- `s3:ListBucket` on the bucket.
- Pulling the container image: the managed policy `AmazonEC2ContainerRegistryReadOnly`.
- Writing its logs: `logs:CreateLogGroup`, `logs:CreateLogStream`, `logs:PutLogEvents`.

(The console offers `AmazonSageMakerFullAccess`. It works, but it's far broader than this needs.)

### 3. Create the model

SageMaker → Inference → Models → Create model:

| Setting | Value |
|---|---|
| Name | `wildfire-xgboost` (the state machine refers to it by this name) |
| IAM role | The execution role above |
| Container | "Provide model artifacts and inference image location" |
| Inference image | The built-in XGBoost image URI for us-east-1 and your chosen version (listed in the SageMaker docs under "Docker registry paths"), or your own image in ECR |
| Model artifacts | `s3://<bucket>/models/wildfire/<trained-date>/model.tar.gz` |

After retraining: upload the new `model.tar.gz` and create a **new** model (for example `wildfire-xgboost-2027-01`), then update the name in the state machine. SageMaker models can't be edited in place.

### 4. The input it expects

- **CSV with no header row and no label column**, one row per county, columns in exactly the model's feature order (`metadata.json` → `features`). Missing values as empty fields.
- `ContentType: text/csv` and `SplitType: Line` in the transform job (05).
- The output is a file named `<input file>.out` in the output path, with one raw score per line, in input order. `calibrate_and_publish` pairs line N with county N from the county list `build_features` wrote.

### 5. Test it once by hand

Before wiring it into the state machine: SageMaker → Inference → Batch transform jobs → Create, with the same settings as the `Inference` state. Compare a few output lines against `WildfireModel.predict_raw` on your laptop for the same rows. They should match to several decimal places. If they don't, it's the version problem.

### Cost and limits

- `ml.m5.large`, one instance, roughly 10 minutes a week including start-up: a few cents a week.
- New accounts sometimes have a quota of 0 for some instance types. If the job fails with a quota error, request an increase under Service Quotas → SageMaker → "ml.m5.large for transform job usage".

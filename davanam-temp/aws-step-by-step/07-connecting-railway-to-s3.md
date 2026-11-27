# 7. Connecting the Railway backend to S3

Today the backend reads `backend/data/wildfire_model.json` from its deployed code, so a new week means a commit and a redeploy. Once the pipeline publishes to S3, the backend can read from there instead and pick up each new week within a minute, with no redeploy.

The code for this already exists (`weekly_scores/store.py`, `S3Store`). It just needs credentials and one setting. The Railway side of this (variables, plus the `boto3` dependency) is also in [../railway-changes.md](../railway-changes.md), for whoever owns the Railway project.

## 1. An IAM user for Railway

Railway isn't on AWS, so it can't use a role. It needs an IAM **user** with access keys, allowed to do as little as possible.

IAM → Users → Create user → name `railway-backend-read` → no console access → attach a policy you create with this JSON (replace `<bucket>`):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "ReadLatestScores",
      "Effect": "Allow",
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::<bucket>/wildfire/latest.json"
    },
    {
      "Sid": "SeeIfItExists",
      "Effect": "Allow",
      "Action": "s3:ListBucket",
      "Resource": "arn:aws:s3:::<bucket>",
      "Condition": { "StringLike": { "s3:prefix": ["wildfire/*"] } }
    }
  ]
}
```

Why both:

- `s3:GetObject` lets it read the file, and also check whether it changed. The backend checks the file's version tag (its ETag) every minute and only downloads when that changes.
- `s3:ListBucket` makes a **missing** file report as "not found" (404). Without it, S3 reports "access denied" (403) for a missing file. The backend would treat that as an error rather than "no file", and log warnings every minute.

Then that user → Security credentials → Create access key → "Application running outside AWS". Copy the key and secret; the secret is shown only once.

## 2. Railway settings

Railway → the backend service → Variables:

| Variable | Value |
|---|---|
| `WILDFIRE_MODEL_URI` | `s3://<bucket>/wildfire/latest.json` |
| `AWS_ACCESS_KEY_ID` | The key from step 1 |
| `AWS_SECRET_ACCESS_KEY` | The secret from step 1 |
| `AWS_DEFAULT_REGION` | `us-west-2` |

boto3 (AWS's Python library) reads the last three automatically.

## 3. One code change

`boto3` must be in `backend/requirements.txt`, which is what Railway installs from. **Done:** `boto3==1.44.12` is there on `feature/add-model-scoring`, so it arrives with the merge to `main`. Nothing else changes: `open_store` sees the `s3://` prefix and uses `S3Store`.

## 4. Check it

After Railway redeploys, open `https://<backend>/api/health` and look at `sources.wildfireModel`:

```json
"wildfireModel": {
  "location": "s3://<bucket>/wildfire/latest.json",
  "available": true,
  "weekStart": "2026-11-30",
  "generatedAt": "2026-11-30T06:41:12+00:00",
  "counties": 3221,
  "error": null
}
```

- `available: false` with `error: "not found"`: nothing published yet, or the wrong path.
- `error` mentions `AccessDenied`: a policy or key problem.
- An old `weekStart`: the pipeline hasn't run this week (check Step Functions).

**Before the first S3 run,** upload the current committed file so the backend has something to read: `aws s3 cp backend/data/wildfire_model.json s3://<bucket>/wildfire/latest.json`.

## Rotating the keys

Access keys don't expire on their own. Every few months, or if one might have leaked: create a second key for the same user, put it in Railway, check `/api/health`, then deactivate and delete the old key. A user can have two keys at once for exactly this reason.

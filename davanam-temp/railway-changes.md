# Railway changes needed

Everything the Railway backend needs for the alert archive and the weekly wildfire scores, in one place. There are two rounds: one now, one when the weekly wildfire scores move to S3.

**Nothing here changes what the site shows until `feature/add-model-scoring` is merged to `main`.** Railway deploys `main`, and the code that reads these settings is on that branch. Setting the variables early does no harm: the current code ignores them.

## Round 1: now (the alert archive is live)

The Lambda now saves NWS alerts to Supabase every 15 minutes. When NWS is down, the backend shows the most recent saved alerts instead, but only if they're recent enough. This setting is that limit.

| Variable | Value | What it does |
|---|---|---|
| `ALERT_ARCHIVE_MAX_AGE_MINUTES` | `30` | How old the last saved alerts can be and still be shown. 30 = one 15-minute run, plus slack for one missed run. Without it, the default (90) lets alerts up to an hour and a half old be shown |

Nothing to install. The backend already has `DATABASE_URL`, which is all the archive needs.

## Round 2: when the weekly wildfire scores move to S3

Today the backend reads the scores from `data/wildfire_model.json` in the repo, so each new week means a commit and redeploy. After this round it reads `latest.json` from S3, which the AWS pipeline replaces every Monday. **Wait for a go-ahead before doing this round.** It only makes sense once the weekly pipeline is running.

### 1. A code change (done in the repo, not in Railway)

The backend needs `boto3`, AWS's Python library, to read S3. Someone with repo access adds it to `backend/requirements.txt` and `backend/pyproject.toml`, refreshes `backend/uv.lock`, and merges to `main`. Both files are updated because we don't know which of the two Railway builds from. Nothing needs installing in Railway itself.

### 2. Variables

| Variable | Value | What it does |
|---|---|---|
| `WILDFIRE_MODEL_URI` | `s3://riskresource-data-bucket/wildfire/latest.json` | Where to read the weekly scores. Unset = the file in the repo |
| `AWS_ACCESS_KEY_ID` | Sent privately, never in chat or git | A read-only AWS key. It can read `latest.json` and nothing else |
| `AWS_SECRET_ACCESS_KEY` | Sent privately | The key's secret |
| `AWS_DEFAULT_REGION` | `us-west-2` | The bucket's region |

### 3. Check it worked

After the redeploy, open `/api/health`:

- `wildfireModel` should show the latest week and about 3,221 counties.
- The deploy logs shouldn't show repeated S3 warnings. If they do, the key or bucket name is wrong.

**To undo:** delete `WILDFIRE_MODEL_URI` and redeploy. The backend goes back to the file in the repo.

## Summary

| When | What | Who |
|---|---|---|
| Now | `ALERT_ARCHIVE_MAX_AGE_MINUTES=30` | Railway owner |
| Before round 2 | Add `boto3` to the backend's dependencies, merge to `main` | Anyone with repo access |
| Round 2 | `WILDFIRE_MODEL_URI`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_DEFAULT_REGION` | Railway owner, with the key sent privately |

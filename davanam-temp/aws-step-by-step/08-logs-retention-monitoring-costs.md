# 8. Logs, retention, monitoring and costs

## Keep everything to a fixed window

By default, CloudWatch keeps logs forever and S3 keeps files forever. Neither costs much at this scale, but "forever" adds up and makes things harder to find. Set a window for each.

### CloudWatch logs: 30 days everywhere

Every Lambda gets a log group named `/aws/lambda/<function-name>`, created on its first run. Set each to 30 days:

```bash
for g in /aws/lambda/nws-alert-archive /aws/lambda/wildfire-fetch-chunk \
         /aws/lambda/wildfire-build-features /aws/lambda/wildfire-calibrate-publish; do
  aws logs put-retention-policy --log-group-name "$g" --retention-in-days 30
done
```

Also do it for the state machine's log group (whatever you named it in 05).

To catch any you missed: CloudWatch → Log groups, and sort by the "Retention" column. "Never expire" means it's not set.

**Reducing volume** (optional). Lambda → the function → Configuration → Monitoring and operations tools → Logging configuration:

- **Log format: JSON.** Easier to search.
- **Application log level: WARN.** Drops routine INFO lines. For the alert archive, that also drops its one-line run summary, which is the most useful line, so keep INFO there. For the wildfire Lambdas, WARN is fine once they're stable.

### S3: lifecycle rules per folder

S3 → the bucket → Management → Create lifecycle rule. One rule per prefix:

| Rule name | Prefix | Action | Why |
|---|---|---|---|
| `expire-raw` | `raw/` | Expire current versions after **14 days** | Weather downloads are only needed during a run, plus a week in case you rerun |
| `expire-features` | `features/` | Expire after **30 days** | Useful for debugging a bad week, not after |
| `expire-weekly-copies` | `wildfire/weeks/` | Expire after **365 days** | A year of published weeks, to check the model against real fires later |
| `old-versions` | (whole bucket) | Permanently delete **noncurrent versions** after **30 days**; also tick **Delete expired object delete markers** and **Delete incomplete multipart uploads** (after 7 days) | With versioning on, every overwrite of `latest.json` keeps the old copy, and the expiry rules above don't really delete anything: they hide the file behind a "delete marker" and keep it as an old version. This rule is what actually removes them after 30 days, then cleans up the leftover markers |

Lifecycle rules run about once a day, so files disappear a day or so after their date, not to the minute.

### Supabase: the alert archive's retention

Covered in [02](02-alert-archive-lambda.md): `archive_settings.retention_days`, 365 by default, enforced by the Lambda at the end of every run. Check the table's size monthly against the free plan's 500 MB.

## Know when something breaks

There are no failure emails or alarms in this setup (SNS was left out). Check these by hand instead:

| What | Where to look | Healthy |
|---|---|---|
| Alert archive | Lambda → `nws-alert-archive` → Monitor → **Errors** and **Invocations** | Errors near zero; about 4 invocations an hour |
| Alert archive, from Supabase | `SELECT last_run_at FROM public.archive_settings;` | Within the last ~15 minutes |
| Weekly pipeline | Step Functions → `wildfire-weekly` → Executions | Monday's run is green. If red, click the red step for the error |
| Scores on the site | `https://<backend>/api/health` → `wildfireModel` | This week's Monday, about 3,221 counties |
| Spending | The AWS Budget from 01 (Budgets emails you directly, no SNS needed) | Under $5 |

The `/api/health` check is the one to do if you only do one. It catches every way the scores can go stale (pipeline broken, S3 permissions changed, Railway misconfigured).

## What it costs

Rough monthly costs in us-west-2. Free-tier allowances are AWS's "always free" ones, which don't expire after 12 months.

| Piece | Usage | Monthly cost |
|---|---|---|
| Alert archive Lambda | ~2,900 runs × a few seconds × 256 MB | $0 (free tier: 1M requests, 400,000 GB-s) |
| Wildfire Lambdas | ~4 runs × ~45 min total × 1-3 GB | $0 (inside the same free tier) |
| Step Functions | ~4 runs × ~20 transitions | $0 (4,000 transitions free) |
| EventBridge Scheduler | ~2,900 + 4 invocations | $0 (14 million free) |
| S3 storage | A few hundred MB at most, with the lifecycle rules | ~$0.01 |
| S3 requests | The backend checks `latest.json` every minute (~43,000 checks a month) plus pipeline writes | ~$0.02 |
| ECR | A ~1 GB image | ~$0.10 (500 MB free for the first year only) |
| CloudWatch logs | Tens of MB with 30-day retention | $0 (5 GB free) |
| **Total** | | **About $0.25/month** |

Things that would change the bill, so avoid them unless you mean to:

- **Putting a Lambda in a VPC.** Reaching the internet from inside a VPC needs a NAT gateway, about $30/month.
- **Secrets Manager** instead of Parameter Store: $0.40 per secret per month.
- **Step Functions logging at ALL**, with large inputs, for a long time. Use ERROR once it's stable.

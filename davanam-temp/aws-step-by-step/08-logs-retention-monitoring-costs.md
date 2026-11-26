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

Also do it for the state machine's log group (whatever you named it in 05), and for SageMaker's `/aws/sagemaker/TransformJobs` if you use it.

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
| `expire-predictions` | `predictions/` | Expire after **30 days** | Same |
| `expire-weekly-copies` | `wildfire/weeks/` | Expire after **365 days** | A year of published weeks, to check the model against real fires later |
| `old-versions` | (whole bucket) | Permanently delete **noncurrent versions** after **30 days** | With versioning on, every overwrite of `latest.json` keeps the old copy. This caps that at 30 days |

Lifecycle rules run about once a day, so files disappear a day or so after their date, not to the minute.

### Supabase: the alert archive's retention

Covered in [02](02-alert-archive-lambda.md): `archive_settings.retention_days`, 365 by default, enforced by the Lambda at the end of every run. Check the table's size monthly against the free plan's 500 MB.

## Know when something breaks

Everything alerts through the one SNS topic from 01.

| What | How | Alert when |
|---|---|---|
| Alert archive failing | CloudWatch alarm on the Lambda's **Errors** metric | Sum ≥ 3 in 1 hour |
| Alert archive not running at all | CloudWatch alarm on its **Invocations** metric | Sum < 2 in 1 hour (should be 4). Set "treat missing data as **breaching**", so zero runs counts as a problem rather than "no data" |
| Weekly pipeline failed | The state machine's `NotifyFailure` step (05) emails directly. As a backup, a CloudWatch alarm on the state machine's **ExecutionsFailed** metric | ≥ 1 |
| Weekly pipeline didn't run | CloudWatch alarm on **ExecutionsStarted** for the state machine | Sum < 1 over 8 days, missing data as breaching |
| Scores stale on the site | An uptime monitor (for example UptimeRobot, free) checking `https://<backend>/api/health` for the text `"available": true` | Keyword missing |
| Spending | The AWS Budget from 01 | 80% of $5 |

The last one, checking from the backend's side, is worth having even with all the others. It catches every way the scores can go stale (pipeline broken, S3 permissions changed, Railway misconfigured) with one check.

## What it costs

Rough monthly costs in us-east-1. Free-tier allowances are AWS's "always free" ones, which don't expire after 12 months.

| Piece | Usage | Monthly cost |
|---|---|---|
| Alert archive Lambda | ~2,900 runs × a few seconds × 256 MB | $0 (free tier: 1M requests, 400,000 GB-s) |
| Wildfire Lambdas | ~4 runs × ~45 min total × 1-3 GB | $0 (inside the same free tier) |
| Step Functions | ~4 runs × ~30 transitions | $0 (4,000 transitions free) |
| EventBridge Scheduler | ~2,900 + 4 invocations | $0 (14 million free) |
| SageMaker Batch Transform (if used) | ~4 × 10 min of `ml.m5.large` | ~$0.10 |
| S3 storage | A few hundred MB at most, with the lifecycle rules | ~$0.01 |
| S3 requests | The backend checks `latest.json` every minute (~43,000 checks a month) plus pipeline writes | ~$0.02 |
| ECR | A ~1 GB image | ~$0.10 (500 MB free for the first year only) |
| CloudWatch logs | Tens of MB with 30-day retention | $0 (5 GB free) |
| SNS email | A handful | $0 |
| **Total** | | **Under $0.50/month**, about $0.25 without SageMaker |

Things that would change the bill, so avoid them unless you mean to:

- **Putting a Lambda in a VPC.** Reaching the internet from inside a VPC needs a NAT gateway, about $30/month.
- **Secrets Manager** instead of Parameter Store: $0.40 per secret per month.
- **Leaving a SageMaker endpoint running.** Batch Transform shuts itself down; a real-time *endpoint* doesn't, and bills around the clock. This pipeline doesn't use endpoints.
- **Step Functions logging at ALL**, with large inputs, for a long time. Use ERROR once it's stable.

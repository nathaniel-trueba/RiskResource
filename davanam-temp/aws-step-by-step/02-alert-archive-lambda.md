# 2. Pipeline 1: the NWS alert archive

**What it does:** every 15 minutes, fetch all active NWS alerts, keep the ones that cover a US county, save the useful fields to Supabase, record the run time, and delete alerts issued more than a year ago.

**Code:** `backend/aws/lambda_function.py` (one file, one dependency: `psycopg`).

## Step 1: Update the database (once)

The new Lambda writes to new tables, and the old Lambda writes to tables that get dropped, so this step and step 3 go together. Do them back to back.

1. Supabase → SQL Editor → New query.
2. Paste the whole of `backend/db/migrations/2026-11-26_nws_alert_archive.sql`, then Run.
3. Check:

   ```sql
   SELECT count(*), min(sent), max(sent) FROM public.nws_alert_archive;  -- the last year of alerts, copied over
   SELECT * FROM public.archive_settings;                                -- one row, retention_days = 365
   SELECT name, enabled FROM public.api_config;                          -- only nws_alerts
   ```

What it did: created `nws_alert_archive` and `archive_settings` (if the backend hadn't already), copied any alerts from the old `weather_alerts` table into the slim format, removed the `api_config` rows for APIs the Lambda no longer calls, **added the `nws_alerts` row the Lambda needs**, and dropped the old tables (`weather_alerts`, `earthquakes`, `gauges`, `weather_observations`, `locations`).

As of 2026-11-26 the old tables and `api_config` were all empty, so nothing is lost by dropping them. The empty `api_config` is likely why the old Lambda wrote nothing: it reads its API settings from that table.

The `nws_alerts` row's `headers` include a `User-Agent` (`UCSD-Risk-Resource-NotForProfit`), which NWS requires. To change it, edit the row in the Table Editor. The Lambda reads it fresh on every run.

## Step 2: Package the code (a zip file)

Lambda runs on Amazon Linux. `psycopg` includes compiled code, so you must download the **Linux** build, even if you're on Windows or a Mac. That's what the `--platform` flag does.

From `backend/aws/`:

```bash
mkdir -p package
pip install --target package --platform manylinux2014_x86_64 --implementation cp \
    --python-version 3.13 --only-binary=:all: "psycopg[binary]==3.3.9"
cp lambda_function.py package/
cd package && zip -r ../alert-archive.zip . && cd ..
```

Result: `alert-archive.zip`, a few MB, well under Lambda's 50 MB upload limit. (Bigger code needs a container image; see [04](04-packaging.md). This one doesn't.)

## Step 3: Create or update the Lambda

Lambda → Create function (or open the existing one) → Author from scratch.

| Setting | Value | Why |
|---|---|---|
| Name | `nws-alert-archive` | |
| Runtime | Python 3.13 | Matches the packaged build |
| Architecture | x86_64 | Matches `manylinux2014_x86_64` above |
| Execution role | Create a new role with basic Lambda permissions | Gives it permission to write logs. It needs nothing else in AWS: it talks to NWS and Supabase over the internet |

Then:

1. **Code → Upload from → .zip file** → `alert-archive.zip`.
2. **Runtime settings → Handler:** `lambda_function.lambda_handler`. That's the file name and the function name, joined by a dot.
3. **Configuration → General configuration:**
   - **Memory: 256 MB.** It processes about 700 alerts; 128 MB works but runs slower.
   - **Timeout: 60 seconds.** A run takes a few seconds. The default 3 seconds is too short. 60 leaves room for NWS being slow (each request waits up to 20 seconds, with retries).
4. **Configuration → Environment variables:** `DATABASE_URL` = the Supabase **session pooler** connection string, without quotes.
5. **Reserved concurrency: leave it unset.** New AWS accounts can only run about 10 Lambdas at once, and AWS refuses any reservation that would leave fewer than 100 unreserved, so it can't be set anyway. It isn't needed: a run takes a few seconds and runs are 15 minutes apart, and if two ever overlapped, they'd write the same rows with the same values.
6. **Don't attach it to a VPC.** Outside a VPC, Lambda has internet access by default. Inside one, it would need a NAT gateway (about $30 a month) to reach NWS and Supabase.

**Test it before scheduling:** Test tab → new event `{"dry_run": true}` → Test. It fetches and maps without writing, and returns a summary with `alerts_fetched`, `alerts_archived` and an `example_row`. Then run `{}` once for real and check Supabase:

```sql
SELECT count(*), max(last_seen_at) FROM public.nws_alert_archive;
SELECT last_run_at FROM public.archive_settings;
```

## Step 4: Schedule it every 15 minutes

**Why 15 minutes and not hourly:** many tornado and severe thunderstorm warnings last 30 to 45 minutes. A job that looks once an hour never sees a lot of them, so the archive would undercount exactly the warnings that matter most. The backup copy would also be up to an hour stale. Every 15 minutes catches nearly all warnings and keeps the backup fresh, and it's still only ~2,900 runs a month, far inside the free tier (1 million requests and 400,000 GB-seconds a month).

Use **EventBridge Scheduler** (newer and simpler than EventBridge "rules"):

1. EventBridge → Scheduler → Schedules → Create schedule.
2. **Name:** `nws-alert-archive-every-15-min`.
3. **Schedule pattern:** Recurring → **Rate-based** → `15 minutes`. (As an expression: `rate(15 minutes)`.)
4. **Flexible time window: Off.** "On" lets AWS start it up to N minutes late to spread load, which you don't want for alerts.
5. **Target:** AWS Lambda Invoke → `nws-alert-archive`. **Payload:** `{}`.
6. **Retry policy:**
   - **Maximum age of event: 10 minutes.** If a run can't start within 10 minutes, skip it; the next one is coming anyway.
   - **Retry attempts: 2.**
7. **Dead-letter queue:** none. A missed run doesn't need replaying.
8. **Permissions:** let it create a new role. That role only allows invoking this one Lambda.

If you already have an hourly rule from the old Lambda, **delete or disable it** so it doesn't also run.

## Step 5: Tell the backend the new freshness

The backend only uses the archive's copy if the Lambda's last run is recent enough. On Railway, set:

```
ALERT_ARCHIVE_MAX_AGE_MINUTES=30
```

That's a 15-minute schedule plus slack for one missed run. (The default, 90, was for hourly runs.) Every Railway change is listed in [../railway-changes.md](../railway-changes.md) for whoever owns the Railway project.

## Step 6: Keep logs and data to a fixed window

**Logs:** CloudWatch keeps Lambda logs forever by default. Set the log group to 30 days:

```bash
aws logs put-retention-policy --log-group-name /aws/lambda/nws-alert-archive --retention-in-days 30
```

Or: CloudWatch → Log groups → `/aws/lambda/nws-alert-archive` → Actions → Edit retention setting → 1 month. (The log group appears after the first run.)

Each run logs one summary line of about 1 KB, so 15-minute runs make about 3 MB a month. That's far under CloudWatch's 5 GB free tier, but without retention it would still grow forever.

**Database:** the archive deletes old alerts itself. At the end of each run, the Lambda deletes alerts whose `sent` time is more than `retention_days` ago.

- To change the window: Supabase → Table Editor → `archive_settings` → edit `retention_days` (1 to 3650). It takes effect on the next run.
- Expected size with 365 days: about 150 to 250 MB, inside the free plan's 500 MB. Check it monthly:

  ```sql
  SELECT pg_size_pretty(pg_total_relation_size('public.nws_alert_archive'));
  ```

- If there's no `archive_settings` row, the Lambda deletes nothing and logs a warning. It never guesses a retention period.

## Step 7: Checking it's healthy (no alarm)

There's no failure email in this setup. The Lambda raises an error when something goes wrong (NWS down, database unreachable), so to check on it:

- **Lambda → `nws-alert-archive` → Monitor:** the **Errors** graph should be at or near zero. One failed run now and then is normal (NWS hiccups).
- **Supabase:** `SELECT last_run_at FROM public.archive_settings;` should be within the last 15 minutes or so.

If it stops running, the site isn't affected unless NWS is also down. The backup just isn't used once it's more than 30 minutes old.

## Settings summary

| Where | Setting | Value |
|---|---|---|
| Lambda | Runtime / architecture | Python 3.13 / x86_64 |
| Lambda | Handler | `lambda_function.lambda_handler` |
| Lambda | Memory / timeout | 256 MB / 60 s |
| Lambda | Reserved concurrency | Unset |
| Lambda | Environment | `DATABASE_URL` |
| Lambda | VPC | None |
| Scheduler | Expression | `rate(15 minutes)`, flexible window off |
| Scheduler | Retry | Max event age 10 min, 2 retries |
| CloudWatch | Log retention | 30 days |
| Supabase | `archive_settings.retention_days` | 365 |
| Railway | `ALERT_ARCHIVE_MAX_AGE_MINUTES` | 30 |

## What's left

### Before the Dec 3 demo
- [ ] **Review and merge this branch into `main`** so Railway deploys the new scoring.
  - On its first start, the backend creates two new tables in Supabase (`nws_alert_archive`, `archive_settings`). That's expected and harmless.
  - No new Python packages are needed on Railway.
- [ ] **Refresh the wildfire scores on Mon Nov 30 or Tue Dec 1:**
  - Run `python -m ml.wildfire.predict_week` from `backend/` with the ML dependencies installed. It takes about 30 minutes.
  - Commit `backend/data/wildfire_model.json` and push, so Railway redeploys.
  - The current file still works until Dec 6 if this slips.
- [ ] **Dry run of the demo path on the live site:** homepage → San Diego on the score card → "Open on the map" → county panel → About → sliders.
- [ ] **Morning of the demo:**
  - Open the Supabase dashboard to make sure the project isn't paused.
  - Load the site once to warm the caches.
  - Have a backup screen recording.

### Lambda (after the demo, or whenever convenient)
- [ ] **Run the migration and deploy the new Lambda together.** The old Lambda writes to tables the migration drops.
  1. In Supabase's SQL Editor, run `backend/db/migrations/2026-11-26_nws_alert_archive.sql`. It keeps the last year of alerts already collected.
  2. Right after, deploy the new `backend/aws/lambda_function.py`.
- [ ] **Change the EventBridge schedule from hourly to every 15 minutes.** Hourly misses short tornado and severe thunderstorm warnings. Still free-tier.
- [ ] **On Railway, set `ALERT_ARCHIVE_MAX_AGE_MINUTES=30`** to match the 15-minute schedule.
- [ ] **Set CloudWatch log retention to 30 days:** `aws logs put-retention-policy --log-group-name /aws/lambda/<function> --retention-in-days 30`

### Known issues
- **Frontend lint: 13 errors.**
  - 6 were already there.
  - 7 came in with `main`'s rewrites of `HeroScoreCard` and `MapControls` (effect hooks and `any` types).
  - The build still passes.
- **The weekly wildfire job is manual,** and on Railway each new week needs a commit and redeploy. If it's missed, scores quietly fall back to history + live only.
- **The model is validated on observed weather, not forecasts.** Live accuracy on forecast weather hasn't been measured yet.
- **In quiet fire weeks, the model's 20% pulls scores down** (most counties get a model score near 0). We should decide if that's the behaviour we want, or if the model should only ever raise scores.
- **No disclaimer on the site** that it isn't a substitute for official warnings.

### Over Thanksgiving break (improvements)
I have detailed notes. The main items:
1. **Automate the weekly scores:** a scheduled job (AWS Fargate, or a Railway cron service) publishing to S3, with the Railway backend reading from S3. No more commits for new weeks.
2. **Tests + CI:** scoring rules, snapshot building, the job↔API file format, Lambda mapping, and API contract tests. Then lint/type-check/build on every PR.
3. **Monitoring:** uptime checks on `/api/health`, alarms if the Lambda or weekly job fails or the scores go stale.
4. **Database:** a real migration tool, weekly backups to S3 (the alert archive can't be rebuilt), and watching the free-plan 500 MB limit.
5. **Model:** measure accuracy on forecast weather, recalibrate on recent years, show "what's driving this week's risk" on county pages, and retrain yearly.
6. **Product:** disclaimer, use the alert archive (e.g. "alerts in the past year" per county), accessibility and mobile checks.

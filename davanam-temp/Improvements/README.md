# Improvements after the presentation

Everything here is for after December 3. None of it is needed for the demo. Each file covers one area, with what's wrong or missing today, what to do about it, and roughly how much work it is.

| File | Covers |
|---|---|
| [01-hosting-and-deployment.md](01-hosting-and-deployment.md) | Getting the backend online, CI/CD, secrets, environments |
| [02-weekly-wildfire-job-on-aws.md](02-weekly-wildfire-job-on-aws.md) | Moving `predict_week` to AWS: Fargate vs Lambda, rate limits, S3, alarms |
| [03-database-and-data-pipeline.md](03-database-and-data-pipeline.md) | Supabase free-tier risks, migrations, backups, keeping reference data fresh, the alert archive |
| [04-reliability-and-monitoring.md](04-reliability-and-monitoring.md) | Uptime checks, alerting, logs, caching across workers, status page, upstream budgets |
| [05-testing-and-ci.md](05-testing-and-ci.md) | Tests worth writing first, CI checks, keeping backend and frontend in sync |
| [06-wildfire-model.md](06-wildfire-model.md) | Validating on forecasts, recalibration, retraining, explanations, new features |
| [07-product-accuracy-and-safety.md](07-product-accuracy-and-safety.md) | Disclaimer, About page claims, scoring design choices, accessibility |

## Suggested order

If you only do a few things, do them in this order. Each makes the ones after it safer.

1. **Automate the weekly wildfire scores end to end** (01, 02): a scheduled job that publishes to S3, read by the Railway backend. Today it's a manual run, a commit and a redeploy.
2. **Add a disclaimer and fix the About page's inaccurate claims** (07). Cheap, and it's a safety site.
3. **Tests for the scoring rules, and CI that runs them** (05). Everything after this changes scoring code.
4. **Uptime monitoring and failure alarms** (04), so you hear about problems before users do.
5. **Database migrations and backups** (03), before the alert archive holds a year of data you'd hate to lose.
6. **Validate the model on forecast weather** (06), before relying on it for a fifth of every score.

## Where things stand (end of November 2026)

- **Frontend:** Next.js, deployed on Vercel.
- **Backend:** FastAPI, deployed on Railway from `main`. Reads the weekly wildfire scores from `backend/data/wildfire_model.json` in the deployed code, so a new week needs a commit and redeploy until the job and the API share S3 (01, 02).
- **Database:** Supabase, free plan.
- **Alert archive Lambda:** AWS Lambda, hourly. Rewritten as an alerts-only archiver, but the new version and its migration aren't deployed yet.
- **Weekly wildfire job:** run by hand (`python -m ml.wildfire.predict_week`). Its AWS handler exists but hasn't been deployed.
- **Tests:** none automated. The frontend lints with 6 errors that were already there.

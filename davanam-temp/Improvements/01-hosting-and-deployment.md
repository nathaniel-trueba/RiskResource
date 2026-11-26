# 1. Hosting and deployment

## Today: Vercel + Railway + Supabase

The frontend is on Vercel and the backend on Railway, both deploying from `main`, with Supabase behind the backend. That's a good shape for this app: the backend is a long-running process (it loads reference data at startup, warms the national snapshot in the background and caches feeds in memory), which suits Railway's always-on services and wouldn't suit serverless functions.

## The weekly wildfire scores on Railway

The Railway backend reads `backend/data/wildfire_model.json` from its own deployed copy of the repo. So today a new week means: run `predict_week` on a laptop, commit the file, push, and let Railway redeploy. If nobody does, the model drops out of the score 13 days after the file's Monday.

Ways to automate it, simplest first:

1. **S3 in between (recommended).** Set `WILDFIRE_MODEL_URI=s3://<bucket>/wildfire/latest.json` on Railway (plus `boto3` in `requirements.txt` and AWS keys with `s3:GetObject`). The weekly job writes there from wherever it runs (02). The backend picks up a new week within a minute, with no commit or redeploy.
2. **A Railway cron service.** Railway can run a service on a cron schedule. A second service from the same repo with the ML dependencies could run `python -m ml.wildfire.predict_week` every Monday. It still needs shared storage such as S3, because a Railway volume belongs to a single service and the API service can't read another service's files.
3. **A GitHub Action on a schedule** that runs the job and commits the file. That keeps today's mechanism, but adds a commit and a redeploy every week.

## Hosting improvements

- **A health check in Railway** on `/api/health`, so a bad deploy is caught before it takes traffic.
- **Pin the Python version.** `pyproject.toml` says 3.14 and `requirements.txt` has no pin. Pin one Railway supports, and keep one dependency file as the source of truth (uv with `pyproject.toml`, or pip with `requirements.txt`).
- **Keep CORS tight.** `CORS_ORIGINS` should list only the Vercel production domain (and preview domains if you use them).
- **Watch Railway usage.** The backend is small, but the 1-minute snapshot rebuild runs constantly. Check its CPU and memory once a week, and set a usage limit on the Railway project.

## CI/CD

Today nothing checks a change before it ships.

- **GitHub Actions on every pull request:** backend `ruff` and `compileall` plus the tests in 05; frontend `npm run lint`, `tsc --noEmit` and `next build`. Block merging on failure.
- **Deploy from `main` only** (as now). Vercel and Railway both support preview deployments for pull requests; use them so changes are seen before they reach production.
- **Deploy the Lambda from CI too** (AWS SAM, or a short `aws lambda update-function-code` step), so it can't drift from the repo the way it could today.

## Secrets and configuration

- Keep `DATABASE_URL` in the host's secret store, never in the repo. For AWS, move the Lambda's `DATABASE_URL` from a plain environment variable to **Secrets Manager** or SSM Parameter Store.
- **Use a separate Supabase project for development.** Today `init_db --refresh`, the Lambda and local runs all write to the one shared database, and a mistake there takes down the demo. A second free project costs nothing.
- **One place for upstream API configuration.** The Lambda reads NWS settings from `api_config`, while the backend hardcodes its URLs. Pick one.

## Environments

A minimal setup that's still safe:

| | Frontend | Backend | Database |
|---|---|---|---|
| Local | `npm run dev` | `uvicorn --reload` | Dev Supabase project |
| Preview (per pull request) | Vercel preview | Optional | Dev Supabase project |
| Production | Vercel production | Railway | Production Supabase project |

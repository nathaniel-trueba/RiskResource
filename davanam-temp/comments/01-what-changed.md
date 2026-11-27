## What changed in `feature/add-model-scoring`

### New scoring model: 40% history, 40% live, 20% wildfire model
- The overall threat score is now **40% historical + 40% live + 20% wildfire model**.
  - Each hazard score is still half history, half live.
  - Hazards still combine weighted toward the worst one.
  - The wildfire model is then added as the final 20%, so the overall score has a deliberate wildfire bias.
- The model's weekly probability becomes a 0-100 score on a log scale: 0.01% → 0, 0.1% → 33, 1% → 67, 10%+ → 100.
- If there's no model score for an area, the overall score uses the hazards alone. It never counts a missing model as 0.
- All the weights and rules are in `backend/app/domain/scoring.py`. `frontend/lib/scoring.ts` mirrors the weights for the site's text.

### Wildfire model hooked up to the backend
- **`python -m ml.wildfire.predict_week`** scores all 3,221 counties for the current week.
  - Weather: NASA POWER for the past 180 days, plus the Open-Meteo forecast for days NASA hasn't published yet.
  - Output: `backend/data/wildfire_model.json`. This week's file (week of Nov 23) is committed.
  - It takes about 30 minutes and is run by hand for now.
- The API doesn't run the model and doesn't need the ML packages. It just reads that file, and picks up a new one within a minute.
- **`backend/weekly_scores/`** is the only code the job and the API share: the file format, plus storage that's a local file today and can be `s3://` later through one setting (`WILDFIRE_MODEL_URI`).
- **`ml/wildfire/handler.py`** is a ready entry point for running the job on an AWS EventBridge schedule later.
- County and state responses include a new `wildfireModel` field. `/api/health` reports whether the model file is current.

### Frontend
- **County and state panels:** new "Wildfire Model · 20% of Score" section.
- **Map:** the legend and "Show" dropdown mention the 40/40/20 split.
- **Homepage score card:** notes the model's share.
- **About page:**
  - Data source cards rewritten to the 8 sources we actually use. Removed HRRR, NIFC and ShakeMap; added Open-Meteo, NOAA river gauges and Census.
  - The live-signal table shows the real scores from the backend, for example Red Flag Warning = 100.
  - The 40/40/20 slider ("Try It Yourself") uses our actual formula.
  - After merging the latest `main`, the page uses the team's rework: a Step 1 → 2 → 3 score diagram (50/50 → 60/40 → 80/20), a restyled live-signal table and simpler slider text. The FEMA rating panel (`NriExplainer`) is hidden there for now; the component is still in the repo.
- **Homepage cards:** corrected the "Built on public data", "See your biggest hazards" and "Live hazard alerts" text.

### AWS Lambda: now an NWS alert archive
- `backend/aws/lambda_function.py` now only archives **county-level NWS alerts**.
  - It keeps the useful fields only (no raw JSON) and skips marine-only alerts.
  - That's about 150-250 MB per year, which fits Supabase's free plan.
- **Retention is one year**, set by `retention_days` in the new `archive_settings` table (editable in Supabase's Table Editor).
- Removed the earthquake, gauge, weather and NRI tasks. The backend and Supabase stay the source of truth for NRI.
- **Backend fallback:** if the API can't reach NWS, it shows the alerts from the Lambda's last run, labelled like "(as of 14:15 UTC; live NWS feed unavailable)".
- **Schema:** new tables `nws_alert_archive` and `archive_settings`. Migration in `backend/db/migrations/2026-11-26_nws_alert_archive.sql`. **Not run yet, see the next comment.**

### Merge with `main`
- Merged `main` into this branch. Conflict resolutions:
  - About intro: describes the actual score.
  - Sliders: both kept, as above.
  - Hero card: kept both sides.

### Docs
- Updated `claude-docs/` (backend, frontend, API usage, human review), `backend/README.md`, the model README and `env.example` to match.

### Tested
- Ran the weekly job for real: all 3,221 counties scored.
- The API loads the scores file.
- Scoring, file format and fallback logic checked with test scripts.
- Lambda alert mapping checked against a real NWS response.
- Frontend builds and type-checks.
- **Not tested against live AWS or Supabase:** the new Lambda, the migration and S3 storage.

# 5. Testing and CI

There are no automated tests. Everything so far was checked by hand or with one-off scripts. Start with the code where a silent mistake would mislead users.

## Tests to write first

**1. Scoring rules (`app/domain/scoring.py`).** Pure functions, so they're quick to test with `pytest`:

- `hazard_score`, `composite_score`, `overall_score`, including the model-missing fallback (overall equals the hazard composite, not 80% of it).
- `wildfire_model_score` at its anchors: 0.01% → 0, 0.1% → 33, 1% → 67, 10% and up → 100, and clamping below and above.
- `tier_for` at each boundary (29/30, 49/50, 74/75).
- `quake_score`, `wind_score`, `wildfire_weather_score` thresholds.

**2. Snapshot building (`services/snapshot.py`)** with the real `data/reference.json` and small fake feeds:

- An alert on one county raises only that county, and its state through population weighting.
- With `alerts=None`, NWS hazards say "live data unavailable".
- With archived alerts, every alert text carries "as of ... live NWS feed unavailable".
- With and without wildfire scores, a state's overall score moves as expected.

**3. The hand-off between the job and the API (`weekly_scores/`).** Round-trip a `WeeklyScores` through `LocalFileStore`, reject a newer `schemaVersion`, read a file without one, drop NaN and out-of-range probabilities. For `S3Store`, use `moto` to fake S3.

**4. The Lambda's mapping (`aws/lambda_function.py`).** Feed `_map_alerts` a saved NWS response (commit a trimmed fixture) and check that marine-only alerts are skipped, county codes are filtered against the county list, and required fields are enforced.

**5. API contract tests.** Use FastAPI's `TestClient` with fake clients (the services already take their clients as constructor arguments) and check each endpoint's response against `frontend/lib/types.ts`.

## Keep the frontend and backend in sync automatically

`schemas.py` and `types.ts` are kept in sync by hand, and so are the 40/40/20 weights in `scoring.py` and `frontend/lib/scoring.ts`.

- Generate TypeScript types from FastAPI's OpenAPI schema (`openapi-typescript`) in CI, and fail if `types.ts` differs.
- Expose the weights in an endpoint (for example `/api/meta`) and have the About page read them, or test that the two files agree.

## CI checks on every pull request

| Area | Checks |
|---|---|
| Backend | `ruff check`, `ruff format --check`, `pytest`, `python -m compileall app aws weekly_scores ml` |
| Frontend | `npm run lint` (fix the 6 existing errors first so it can be required), `tsc --noEmit`, `next build` |
| Lambda | Its tests, and package it to catch import errors |
| Model | Optional and slower: rerun `train.py` on a sample and check the metrics didn't regress |

## Smoke test after each deploy

A small script, or a GitHub Action after deployment: request `/api/health`, `/api/states/CA`, `/api/counties/06065` and `/api/map-values?level=state&metric=compositeScore`, and fail on a non-200 or an empty hazard list. That covers the demo path.

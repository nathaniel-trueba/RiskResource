# Wildfire ignition model

An XGBoost model that gives, for every county and week, the **probability that a large
wildfire starts in that county that week**. It's 20% of the site's overall threat score
(40% historical, 40% live, 20% this model), which gives the overall score a wildfire
bias. See [Weekly scores for the API](#weekly-scores-for-the-api).

- Supervised binary classification, one row per county per week (Monday to Sunday).
- Fires are rare (about 0.2% of county-weeks), so fire rows are weighted with
  `scale_pos_weight = (y_train == 0).sum() / (y_train == 1).sum()`, and early
  stopping uses `eval_metric="aucpr"`.
- That weighting inflates the raw probabilities, so they're calibrated afterwards
  with isotonic regression (sklearn), fit on years the model didn't train on.
- Trained on 2010-2020 only and tested on 2021 onward, so nothing leaks backwards in
  time.

## Running it

From `backend/`, with the venv active:

```bash
pip install -r requirements.txt -r requirements-ml.txt
python -m ml.wildfire.build_dataset   # Downloads data, builds data/county_weeks.parquet
python -m ml.wildfire.train           # Trains, calibrates, evaluates, writes artifacts/
```

The first `build_dataset` run downloads about 1,900 NASA POWER grid cells (roughly
5 to 30 minutes, depending on the API). Everything is cached under `data/raw/`
(git-ignored), so later runs only rebuild. Training takes a few minutes.

## Data

| What | Source | Notes |
|---|---|---|
| Labels and fire history | [MTBS](https://www.mtbs.gov/) fire occurrence points, via the USFS EDW ArcGIS service | Wildfire and Wildland Fire Use only (prescribed burns excluded). Ignition date and point. |
| Weather | [NASA POWER](https://power.larc.nasa.gov/) daily point API (MERRA-2) | Max temperature, dew point, humidity, max wind, precipitation, soil wetness. One request per 0.5 x 0.625 degree grid cell. |
| Counties | `backend/data/reference.json` (the data seeded into Supabase) and the Plotly county GeoJSON | Centroid, population, boundary (for assigning fires and area). |
| Elevation | Open-Meteo elevation API | At each county centroid. |

**Why MTBS for the labels.** NIFC's incident feeds (WFIGS, InFORM) include small fires,
but their yearly counts jump about fourfold from 2020 as state and local agencies
started reporting to them (InFORM: about 17k wildfires in 2010, about 100k in 2021).
Training on 2010-2020 and testing on 2021+ with those labels would mostly measure the
change in reporting. MTBS maps fires from satellite imagery with the same method and
size thresholds since 1984, so its counts are comparable across years. The trade-off
is that it only covers **large** fires: about 1,000+ acres in the West and 500+ in
the East. So the model predicts "a large wildfire starts here this week", which is
also the kind of fire that threatens homes.

**Why NASA POWER for weather.** Open-Meteo's historical API would need about 1.2
million weighted calls for 15 years of daily data in every county. Its free tier
allows 10,000 a day. NASA POWER has no key and no daily quota.

## Features

All feature code is in `features.py`, which both training and inference use.

| Group | Features |
|---|---|
| This week (a forecast, at inference time) | Mean and max temperature, vapor pressure deficit, afternoon humidity, wind, precipitation, dry days |
| Before the week | 30 and 90 day precipitation, 30 day heat and VPD, 7 day soil wetness, days since 2.5 mm of rain |
| Anomalies | This week or period minus that grid cell's normal for the week of the year. Normals come from 2010-2018 only. |
| Fire history | Large fires per year in the county, within 50 km, within 100 km, and within 100 km in the same month. Each row only counts fires from **years before its own**, so history never includes the row's year or later. |
| Static | Latitude, longitude, elevation, log area, log population density |
| Season | Week of the year as sine and cosine |

## Splits

Split by ISO year (a week belongs to the year of its Thursday), so no week is in two
splits.

| Step | Years | What happens |
|---|---|---|
| Fit | 2010-2017 | First fit, with `scale_pos_weight` from these rows |
| Early stopping | 2018 | Picks the number of trees, by PR-AUC |
| Refit | 2010-2018 | Final model with that number of trees, `scale_pos_weight` from these rows |
| Calibration | 2019-2020 | Isotonic regression from raw score to probability |
| Test | 2021-2024 | Only used for the metrics below |

2025 isn't used, because MTBS publishes a year's fires about a year later and its
2025 list is still incomplete.

## Results

From the run on 2026-11-21. Full numbers are in `artifacts/metadata.json`.

| Set | County-weeks | Fires | Fire rate |
|---|---|---|---|
| Fit (2010-2017) | 1,343,157 | 3,184 | 0.24% |
| Refit (2010-2018) | 1,510,649 | 3,637 | 0.24% |
| Calibration (2019-2020) | 338,205 | 714 | 0.21% |
| Test (2021-2024) | 669,968 | 1,442 | 0.22% |

Early stopping chose 335 trees. `scale_pos_weight` was 414.4 for the refit.

**Test set (2021-2024)**, compared with a baseline that predicts each county's
2010-2020 fire rate for that month:

| Metric | Model | Baseline |
|---|---|---|
| PR-AUC | **0.081** | 0.066 |
| ROC-AUC | **0.953** | 0.792 |
| Fires caught in the top 5% of county-weeks | **74%** | 59% |
| Fire rate in the top 1% of county-weeks | **7.7%** (36x the 0.22% average) | 6.8% |
| Log loss | **0.0107** | 0.0191 |

PR-AUC by test year, model vs baseline: 2021 0.080 vs 0.064, 2022 0.083 vs **0.095**,
2023 0.061 vs 0.036, 2024 0.098 vs 0.081. The model wins three of the four years; in
2022 fire history alone did better.

A PR-AUC of 0.08 sounds low, but it's typical for this problem: which county-week a
large fire starts in depends heavily on chance (a lightning strike, a spark). The
model's job is to rank risk, and it does: most fires happen in the 5% of
county-weeks it rates highest.

**Calibration.** The raw model's average prediction on the test set is 10.1%,
against a real fire rate of 0.22%, which is the inflation from `scale_pos_weight`.
After isotonic calibration the average is 0.27%. By bin:

| Predicted | County-weeks | Fires | Mean predicted | Observed |
|---|---|---|---|---|
| < 0.01% | 449,684 | 18 | 0.001% | 0.004% |
| 0.03-0.1% | 71,100 | 47 | 0.06% | 0.07% |
| 0.1-0.3% | 39,569 | 46 | 0.12% | 0.12% |
| 0.3-1% | 55,621 | 245 | 0.55% | 0.44% |
| 1-3% | 24,888 | 392 | 1.9% | 1.6% |
| 3-10% | 9,514 | 455 | 6.3% | 4.8% |
| > 10% | 1,621 | 230 | 19.9% | 14.2% |

Between about 0.03% and 0.3% it matches closely. Below that it underestimates, but
those bins hold only 27 fires among about 470,000 county-weeks. Above 0.3% it
**overestimates by about a quarter** in 2021-2024. The calibrator was fit on 2019-2020, so the likely cause is
that the inputs drifted afterward (hotter and drier weeks, and more fire history
accumulating each year). For the live score, consider refitting only the calibrator
on the most recent years. That doesn't touch the trees and keeps the test years
honest, as long as they're no longer used for evaluation.

At the very top, the highest raw scores calibrate to **100%**. Isotonic regression
set that step from only 8 calibration rows (7 had fires). In the test years 15
county-weeks got 100% and 11 had a fire: very risky, not certain. The live score
should cap the probability (or use it as a rank) rather than show 100%.

The calibrated PR-AUC (0.081) is slightly below the raw one (0.086). Isotonic
regression is a step function, so it gives many rows the same probability, and those
ties cost a little ranking detail. It doesn't change the ranking otherwise.

**What drives it** (mean absolute SHAP on the test years): fire history in the county
and within 100 km in the same month, county size, then this week's afternoon humidity
compared to normal, rain over the previous 30 and 90 days, VPD compared to normal, and
days since rain. History and size set where fires are likely. Weather sets which
weeks are risky.

## Notebooks

`notebooks/` has the results with their charts, saved with outputs so they can be
read on GitHub without running anything. They call the modules above rather than
copying their code, so the `.py` files stay the single source of truth.

| Notebook | Shows |
|---|---|
| `01_data.ipynb` | Why MTBS (InFORM vs MTBS counts per year), the training table and splits, fire rate by year and month, a map of ignitions, and how fire rates change with the weather features |
| `02_train_evaluate.ipynb` | Training setup, the early-stopping curve, test metrics against the baseline, fires caught vs share flagged, precision-recall, the calibration mapping and reliability, results by year, and feature importance. Set `RETRAIN = True` to retrain first. |
| `03_predict.ipynb` | Scoring every county for one week the way the backend will, a probability map against where fires actually started, and SHAP explanations of what raises a score |

They need `build_dataset.py` and `train.py` to have been run. To re-run one and save
its outputs, from `backend/ml/wildfire/notebooks/`:

```bash
python -m jupyter nbconvert --to notebook --execute --inplace 02_train_evaluate.ipynb
```

`viz.py` in that folder sets up the import path and the shared chart style.

## Artifacts

`train.py` writes `artifacts/`, which is everything inference needs:

| File | Contents |
|---|---|
| `model.json` | XGBoost booster |
| `calibration.json` | Isotonic step function (`x` raw score, `y` probability), applied the same way sklearn's `IsotonicRegression.predict` does, so it matches the evaluated calibrator exactly. No pickle. |
| `climatology.parquet` | Normals for the anomaly features, per grid cell and week of the year |
| `history_latest.parquet` | Fire history features as of now (fires through 2024), per county and month |
| `county_static.parquet`, `county_cells.parquet` | Static features, and each county's NASA POWER cell |
| `metadata.json` | Feature list, parameters, splits, `scale_pos_weight` and all metrics |
| `feature_importance.csv` | Mean absolute SHAP value on the test years, and gain |

## Weekly scores for the API

The API doesn't load this model. Once a week, from `backend/` with the ML dependencies
installed:

```bash
python -m ml.wildfire.predict_week                    # This week (Monday on or before today, UTC)
python -m ml.wildfire.predict_week --week 2026-11-23  # A specific Monday
```

It downloads 180 days of NASA POWER weather for every grid cell (about 30 minutes at the
default 60 requests a minute; downloads are cached under `data/live/`, so a re-run only
fetches what failed), fills the days POWER doesn't have yet from the Open-Meteo
forecast, scores every county, and publishes the result to `--output`, else `WILDFIRE_MODEL_URI`, else `backend/data/wildfire_model.json`. An `s3://bucket/key` works too (needs boto3). The format is defined in `backend/weekly_scores/contract.py`:

```json
{"schemaVersion": 1, "weekStart": "2026-11-23", "generatedAt": "...", "modelTrainedAt": "...",
 "probabilities": {"06065": 0.00142, "...": 0}}
```

The API re-reads the file when it changes and turns each probability into a 0 to 100
score on a log scale (`wildfire_model_score` in `app/domain/scoring.py`: 0.01% is 0,
1% is 67, 10% or more is 100). The file counts for 13 days after its Monday; after
that, and for counties missing from it, the overall score uses the hazards alone.

On AWS, an EventBridge schedule calls `lambda_handler` in `handler.py`, which runs the same `score_week` and `publish`. See its docstring for packaging and the 15-minute Lambda limit.

**Not yet validated on forecast inputs.** Check a few weeks of output against where fires
actually started before relying on it.

## Using the model

```python
from ml.wildfire.model import WildfireModel

model = WildfireModel.load()
X = model.features_for_week(daily, week_start)  # One row per county
probability = model.predict(X)                  # Calibrated weekly probability
drivers = model.explain(X)                      # SHAP: what pushes each county up or down
```

`daily` holds one wide DataFrame per NASA POWER parameter: dates from 180 days before
`week_start` to `week_start + 6`, and one column per cell id in
`artifacts/county_cells.parquet`. The precipitation windows need 90 days;
`days_since_rain` needs 180 to reach the same cap as in training. For a live score, the days before the week are
observed (NASA POWER's near-real-time data lags a few days), and the week itself
comes from a forecast.

Things `predict_week.py` handles, and what's still open:

- **Forecast weather.** The model learned from reanalysis weather. A forecast from
  Open-Meteo has different biases, especially for wind and humidity. Map Open-Meteo's
  variables onto the POWER names (`temperature_2m_max`, `dew_point_2m_mean`,
  `relative_humidity_2m_mean`, `wind_speed_10m_max` in m/s, `precipitation_sum`), and
  check that the scores look sensible before relying on them. Soil wetness only uses
  the days before the week, so it can come from POWER.
- **Turning the probability into a 0-100 score.** Weekly probabilities are small (a
  typical county-week is well under 1%), so a linear scale would put almost everyone
  near 0. A percentile or log scale, or the ratio to the county's usual probability
  for that week, works better. The ratio also shows how far this week is from
  baseline.
- **"What's raising the score."** `explain()` returns per-feature contributions. Group
  them for the website (weather this week, dryness before it, history, location).

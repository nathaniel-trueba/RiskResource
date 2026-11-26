# 6. The wildfire model

## Validate it on forecast weather

All test results (half of large-fire starts caught in each week's top 100 counties, and so on) used observed weather for the week being scored. The live site uses a forecast for that week. Nobody has measured how much worse that is.

- **Save every weekly run** (keep each week's file in S3, not just the latest) and, a year later, compare against MTBS fires for those weeks.
- **Faster check:** rerun past weeks with archived Open-Meteo forecasts (its historical forecast API) and compare the top-100 recall against the observed-weather numbers.
- **Bias-correct the forecast.** Open-Meteo and NASA POWER disagree systematically, especially on wind and humidity. Fit a per-variable correction on overlapping days, or train the model's weekly features on forecast-like noise.

## Calibration

- In 2021-2024 the model overestimated by about a quarter above 0.3%, probably because recent years were hotter and drier than the 2019-2020 calibration years. Refit only the isotonic calibrator on recent years. That doesn't touch the trees.
- The calibrator's top step reaches 100% from 8 rows. The score's 10% ceiling hides it, but the probability field in the API can still show it; cap it there too.

## Turning probability into the score

The log scale (0.01% → 0, 1% → 67, 10% → 100) was chosen, not fitted. Alternatives worth comparing:

- **Ratio to the county's normal for that week.** "3x more likely than usual for this time of year" is easier to explain and separates "always risky" from "unusually risky now".
- **Weekly percentile among counties.** Always uses the full 0-100 range, but a quiet week nationally would still show some counties as Critical.

**Design question to revisit:** in a quiet fire week, most counties get a model score near 0, so the 20% share pulls their overall score down (New York went from 23 to 19). If the model should only ever raise scores, make it a boost on top of the hazard composite instead of a fixed share.

## Explanations

`WildfireModel.explain()` already returns per-feature SHAP contributions. Group them into four buckets (this week's weather, dryness before it, fire history, location) and show the top driver on the county page: "Higher than usual: very little rain in the past 30 days." This is the single most useful addition for the "explainable" pitch.

## Better features

- **Red Flag Warning history** from the alert archive (or Iowa Environmental Mesonet for past years): days with a Red Flag Warning in the last 30 days, and per year.
- **Vegetation and fuel dryness:** satellite vegetation indices (MODIS NDVI) or fuel moisture data.
- **Wildland-urban interface share** of each county, for "fires that threaten homes".
- **Finer than counties:** large counties like Riverside mix desert, mountains and suburbs. Scoring a grid (the POWER cells already are one) and showing the worst cell, or a population-weighted average, would be more honest than one county number.

## Operations

- Retrain yearly when MTBS publishes the previous year (02).
- Version artifacts and record which model version produced each week's file (`modelTrainedAt` is already in the document).
- Write each week's top 100 counties and their drivers to a log, so a surprising week can be investigated later.

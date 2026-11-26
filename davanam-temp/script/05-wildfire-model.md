# 5. The wildfire model

## What it does

Every week, the model estimates for each of the 3,221 US counties **the probability that a large wildfire starts there that week**. "Large" follows the national MTBS definition: roughly 1,000+ acres in the West and 500+ acres in the East, which is the kind of fire that threatens homes. That probability is turned into a 0 to 100 score and makes up 20% of the overall threat score.

## Why XGBoost

XGBoost is a "gradient-boosted decision tree" method: it builds hundreds of small decision trees, each one correcting the mistakes of the ones before. We chose it because it fits this problem well:

- **It's the standard choice for table-shaped data.** Our data is one row per county per week, with a few dozen numeric columns (weather, dryness, fire history, geography). Tree ensembles like XGBoost consistently do best on this kind of data, usually ahead of neural networks, which need far more data and tuning.
- **Wildfire risk is about combinations.** A hot week isn't dangerous on its own, and neither is a windy one. Hot *and* dry *and* windy, after weeks without rain, in a county that has burned before, is. Decision trees capture those interactions naturally, where a simple linear model can't.
- **It handles missing data.** Some weather readings are occasionally missing. XGBoost learns what to do when a value is absent, instead of us having to guess.
- **It copes with rare events.** Large fires happen in only about 1 in 450 county-weeks. XGBoost lets us weight those rare fire weeks more heavily, so the model doesn't learn to just say "no fire" every time.
- **It's explainable.** For any county and week we can break the prediction into the factors that pushed it up or down (for example "very dry 30 days" or "low humidity this week"), which matters for a site built on transparency.
- **It's fast and light.** It trains on 1.5 million rows in minutes, and the saved model is a few megabytes, so it's cheap to run every week.

## What data we trained on

| Ingredient | Source | Details |
|---|---|---|
| **When and where large fires started** (what we predict) | MTBS satellite-mapped fire records | Every large wildfire start, 2010 to 2024. Prescribed burns excluded |
| **Weather** | NASA POWER daily weather (a reanalysis blending satellites, stations and models) | Temperature, humidity, wind, rain and soil moisture, every day since 2009, for about 1,900 locations |
| **Fire history** | MTBS, back to 1984 | How often large fires have started in and around each county, counting only years *before* the one being predicted |
| **Geography** | County boundaries, Census population, elevation | Location, elevation, county size, population density |

The training table has about **2.5 million county-weeks** (every county, every week, 2010 to 2024), of which about **5,800 had a large fire start**.

The model sees 36 measurements per county-week, in five groups:

1. **This week's weather:** heat, how dry the air is, afternoon humidity, wind, rain.
2. **The weeks before:** rain over the past 30 and 90 days, recent heat, soil moisture, and how many days since it last rained.
3. **How unusual it is:** how this week compares to normal for that place and time of year.
4. **Fire history:** how often large fires have started in the county and within 50 and 100 km.
5. **Place and season:** location, elevation, size, population density, time of year.

**Why MTBS for the fire records:** other national fire databases started including far more small and local fires around 2020, so their counts jump about fourfold. A model trained on them would mostly learn that reporting changed. MTBS has mapped fires the same way since 1984, so its records can be compared across years.

## How we tested and validated it

**We tested on the future, not on random samples.** The data was split by year, so the model is always judged on years it has never seen:

| Years | Used for |
|---|---|
| 2010 to 2018 | Training the model |
| 2019 to 2020 | Calibration, so the predicted percentages match real-world fire rates |
| **2021 to 2024** | **Testing only.** Never used to build or tune anything |

That mimics real use: the model was built from the past and is judged on how well it predicted what came next. Fire history features also only count fires from earlier years, so nothing from the future leaks into a prediction.

**We compared it to a strong, simple baseline:** "predict each county's historical fire rate for that month." That's essentially what you'd get from fire history alone. A useful model has to beat it, and it does.

## How it performs (2021 to 2024 test years)

These are measured on 1,442 county-weeks with large fire starts across four test years, 669,968 county-weeks in total.

**Headline numbers for slides:**

- **Each week, the 100 counties the model ranks highest, just 3% of US counties, contained half of all large wildfires that started that week** (720 of 1,442). Using fire history alone, the same 100 counties caught 42%.
- **The top 10% of counties each week caught 81% of large wildfire starts**, compared with 63% from fire history alone.
- **A county in the model's weekly top 100 was 16 times more likely than an average county to have a large fire start that week.** In the top 25, it was 29 times more likely.
- **Across the whole test period, the 5% of county-weeks the model rated riskiest contained 74% of all large fire starts** (59% for fire history alone).
- **It's consistent year to year:** the weekly top 100 caught 47%, 48%, 49% and 55% of fires in 2021, 2022, 2023 and 2024.
- **In 83% of the weeks that had any large fire, at least one of those fires was in the model's top 100.**

**By how many counties are flagged each week:**

| Counties flagged per week | Share of all counties | Share of fire starts caught: model | Fire history alone |
|---|---|---|---|
| Top 25 | 0.8% | 22% | 19% |
| Top 50 | 1.6% | 34% | 30% |
| Top 100 | 3.1% | 50% | 42% |
| Top 160 | 5.0% | 63% | 52% |
| Top 320 | 9.9% | 81% | 63% |

**For a technical audience:** ROC-AUC of 0.95 (fire history alone: 0.79), and precision-recall AUC of 0.081 (fire history alone: 0.066). The PR-AUC sounds low, but it's typical for rare, partly random events: whether a large fire starts in a given county in a given week depends heavily on chance (a lightning strike, a spark from equipment). The model's job is to rank which places and weeks are most dangerous, and it does that well.

**What drives its predictions**, in order: fire history in and around the county, county size, then this week's humidity compared to normal, rain over the past 30 and 90 days, how dry the air is compared to normal, and days since rain. In short, **history and geography say where fires are likely, and weather says which weeks.**

## Honest caveats to mention

- **These results use observed weather.** In testing, the model saw the actual weather for each week. On the live site, the current week comes from a forecast, which is less accurate, so live performance is probably somewhat lower than these numbers.
- **Most flagged counties won't have a fire that week.** Even in the top 25, about 6% of county-weeks had a large fire start. The model identifies *elevated* danger, not certainty.
- **The probabilities run a little high** for the riskiest weeks (by about a quarter in 2021 to 2024), likely because recent years were hotter and drier than the years it was calibrated on. That affects the exact percentage, not the ranking.

# 4. What data we collect

Every source is free and public. None needs an API key, and every request identifies us as a non-profit project.

## Live data (fetched while the site runs)

| Source | Agency | What it provides | How often |
|---|---|---|---|
| **Active weather alerts** | National Weather Service (NOAA) | Every active warning, watch and advisory in the US: Red Flag Warnings, flood and flash flood warnings, tornado and hurricane warnings, high wind advisories | Refreshed every 5 minutes, one request for the whole country |
| **Recent earthquakes** | U.S. Geological Survey | Every magnitude 3+ earthquake in the past week, with location and strength | Refreshed every 5 minutes |
| **Weather forecast** | Open-Meteo | Next 24 hours of wind gusts and humidity at the county's center, used to spot damaging winds and fire weather | When a county is opened, refreshed every 30 minutes |
| **River gauges** | NOAA National Water Prediction Service | Whether rivers in and near the county are observed or forecast to reach flood stage | When a county is opened, refreshed every 15 minutes |
| **Place search** | Open-Meteo Geocoding | Turns a city or ZIP code into a county | When a search doesn't match a county name |

## Archived data (collected by our AWS Lambda)

| Source | Agency | What it provides | How often |
|---|---|---|---|
| **Alert archive** | National Weather Service | Every county-level alert (what, how severe, which counties, when), kept for a rolling year. Builds a history NWS doesn't offer, and backs up the live feed when NWS is unreachable | Every 15 minutes |

## Weekly data (for the wildfire model)

| Source | Agency | What it provides |
|---|---|---|
| **Daily weather history** | NASA POWER | The last 180 days of temperature, humidity, wind, rain and soil moisture for about 1,900 locations covering the US |
| **Weather forecast** | Open-Meteo | The coming days' temperature, humidity, wind and rain, to fill in the days NASA hasn't published yet |

## Historical and reference data (collected once, stored in our database)

| Source | Agency | What it provides | Used for |
|---|---|---|---|
| **Disaster declarations** | FEMA (OpenFEMA) | Every federal disaster declaration since 2006, by county and type (fire, flood, hurricane, severe storm, tornado and more) | The historical part of each hazard score |
| **Earthquake history** | U.S. Geological Survey | Every magnitude 4.5+ earthquake in the US since 2006 | Earthquake history, where FEMA declarations are too rare to compare counties |
| **National Risk Index** | FEMA | Modeled average yearly losses in dollars per hazard, plus ratings of each community's social vulnerability and resilience | The Expected Annual Loss panels and map views (shown separately from the score) |
| **Population estimates** | U.S. Census Bureau | Population of every county | Weighting state scores toward where people live, and ranking search results |
| **County boundaries** | Census boundaries (via Plotly's public GeoJSON) | The shape and location of every county | Drawing the map, locating counties, matching earthquakes and gauges to counties |

## Training data (for building the wildfire model)

| Source | Agency | What it provides |
|---|---|---|
| **Large wildfire records** | MTBS (Monitoring Trends in Burn Severity), a USGS and US Forest Service program | The start date and location of every large wildfire since 1984, mapped from satellite imagery with the same method every year |
| **Weather history, 2009 to 2024** | NASA POWER | 15 years of daily weather for every location |
| **Elevation** | Open-Meteo | Elevation of each county's center |

## How live and historical data work together

- **Historical data answers "how often does this happen here?"** It changes slowly and is refreshed when we rebuild the database.
- **Live data answers "is something happening right now?"** It's usually quiet (most counties have no active warnings on a given day), and spikes when a real event begins.
- **The wildfire model answers "how likely is a large fire this week?"** It sits between the two: it's built from history, but updated every week with the latest weather.

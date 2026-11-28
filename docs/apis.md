# External APIs and data sources

Audience: developers and coding agents who need to know which outside services the project depends on.

Every API Risk Resource uses, grouped by what calls it, with its documentation and base URL. None need an API key. Exactly what's requested from each, which fields are read and each one's limits are in [`apis-usage.md`](apis-usage.md).

We use all of this data for a non-commercial, educational project. Server-side requests identify themselves with the User-Agent `UCSD-Risk-Resource-NotForProfit` to make that clear.

## Live data (the API, on demand)

| API | Documentation | Base URL |
|---|---|---|
| NWS Active Alerts | https://www.weather.gov/documentation/services-web-api | https://api.weather.gov/alerts/active |
| USGS Earthquake Catalog | https://earthquake.usgs.gov/fdsnws/event/1/ | https://earthquake.usgs.gov/fdsnws/event/1/query |
| Open-Meteo Forecast | https://open-meteo.com/en/docs | https://api.open-meteo.com/v1/forecast |
| NOAA NWPS Gauges | https://api.water.noaa.gov/nwps/v1/docs/ | https://api.water.noaa.gov/nwps/v1/gauges (requires a User-Agent) |
| Open-Meteo Geocoding | https://open-meteo.com/en/docs/geocoding-api | https://geocoding-api.open-meteo.com/v1/search |

## Reference data (the build script, monthly)

| API | Documentation | Base URL |
|---|---|---|
| OpenFEMA Disaster Declarations Summaries | https://www.fema.gov/openfema-data-page/disaster-declarations-summaries-v2 | https://www.fema.gov/api/open/v2/DisasterDeclarationsSummaries |
| USGS Earthquake Catalog (history) | As above | As above |
| FEMA National Risk Index (NRI), Counties layer | https://hazards.fema.gov/nri/ | https://services.arcgis.com/XG15cJAlne2vxtgt/arcgis/rest/services/National_Risk_Index_Counties/FeatureServer/0/query |
| US Census county population estimates (2021 and 2019 files) | https://www.census.gov/programs-surveys/popest.html | https://www2.census.gov/programs-surveys/popest/datasets/ |
| US counties GeoJSON (Plotly) | | https://raw.githubusercontent.com/plotly/datasets/master/geojson-counties-fips.json |

OpenFEMA's own API doesn't serve the NRI (it's "Files Only"), so we use FEMA's official ArcGIS layer. Census, the county GeoJSON and Open-Meteo geocoding were added because none of the other APIs provide population, county names or place search.

## Scheduled jobs (AWS)

| API | Called by | Documentation | Base URL |
|---|---|---|---|
| NWS Active Alerts | The alert archive Lambda, every 15 minutes | As above | As above |
| NASA POWER Daily | The weekly wildfire pipeline | https://power.larc.nasa.gov/docs/services/api/ | https://power.larc.nasa.gov/api/temporal/daily/point |
| Open-Meteo Forecast (daily) | The weekly wildfire pipeline | As above | As above |

NASA POWER is rate-limited to about 100 requests a minute, so we send 60. It's also the weather the model was trained on.

## Model training only

Used by `backend/ml/wildfire/build_dataset.py` when the wildfire model is retrained, not in production.

| Source | Documentation |
|---|---|
| MTBS fire occurrence points, via the USFS EDW ArcGIS service | https://www.mtbs.gov/ |
| NASA POWER Daily | As above |
| Open-Meteo Elevation | https://open-meteo.com/en/docs/elevation-api |

## The browser (frontend)

| API | Documentation | Used for |
|---|---|---|
| Photon | https://photon.komoot.io/ | Address suggestions |
| FCC Census Area API | https://geo.fcc.gov/api/census/ | Address coordinates to county FIPS |
| Nominatim | https://nominatim.org/release-docs/latest/api/Search/ | Home page search fallback |
| US states GeoJSON (folium) | https://github.com/python-visualization/folium-example-data | State polygons |
| US counties GeoJSON (Plotly) | As above | County polygons |
| CARTO basemaps, or OpenStreetMap tiles | https://carto.com/basemaps | Map background |

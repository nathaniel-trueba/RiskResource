APIs that our backend wraps:
- Open-Meteo Forecast API: 
    - Documentation: https://open-meteo.com/en/docs
    - Base Request URL: https://api.open-meteo.com/v1/forecast
- USGS Earthquake Catalog:
    - Documentation: https://earthquake.usgs.gov/fdsnws/event/1/
    - Request URL Format: https://earthquake.usgs.gov/fdsnws/event/1/[METHOD[?PARAMETERS]]
- NOAA NWPS API:
    - Documentation: https://api.water.noaa.gov/nwps/v1/docs/
    - Base Request URL: https://api.water.noaa.gov/nwps/v1
    - Requests require a User-Agent header.
- NWS API:
    - Documentation: https://www.weather.gov/documentation/services-web-api
    - Base Request URL: https://api.weather.gov
- FEMA Disasters Historical Data:
    - Documentation: https://www.fema.gov/openfema-data-page/disaster-declarations-summaries-v2
    - Base Request URL: https://www.fema.gov/api/open/v2/DisasterDeclarationsSummaries
- FEMA National Risk Index (NRI), for expected annual loss:
    - Documentation: https://hazards.fema.gov/nri/ and https://www.fema.gov/about/openfema/data-sets/national-risk-index-data
    - Base Request URL (ArcGIS feature service): https://services.arcgis.com/XG15cJAlne2vxtgt/arcgis/rest/services/National_Risk_Index_Counties/FeatureServer/0/query
    - OpenFEMA's API doesn't serve the NRI ("Files Only"), so we use FEMA's official ArcGIS layer.

Also used, because none of the APIs above provide population, county names or place search:
- Census county population estimates (2021 and 2019 files): https://www2.census.gov/programs-surveys/popest/datasets/
- County boundaries GeoJSON (Plotly): https://raw.githubusercontent.com/plotly/datasets/master/geojson-counties-fips.json
- Open-Meteo Geocoding API: https://geocoding-api.open-meteo.com/v1/search

Used by the wildfire model (weekly, outside the API: the AWS pipeline in backend/aws/ or ml/wildfire/predict_week.py):
- NASA POWER Daily API (daily weather from the MERRA-2 reanalysis, per grid cell):
    - Documentation: https://power.larc.nasa.gov/docs/services/api/
    - Base Request URL: https://power.larc.nasa.gov/api/temporal/daily/point
    - No API key. Rate-limited to about 100 requests a minute (HTTP 429 above that), so we send 60 a minute.
    - Also the weather source the model was trained on.
- Open-Meteo Forecast API (above): fills in the days POWER doesn't have yet.

See apis-usage.md for exactly how each one is called.

Notes:
- We are not requesting any data for commercial use
- For now we'll call our User-Agent "UCSD-Risk-Resource-NotForProfit" to make it extra clear that we are not using any of this data for profit.
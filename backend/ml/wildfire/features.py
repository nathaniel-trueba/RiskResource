"""Feature engineering shared by training (build_dataset.py) and inference (model.py).

A row is one county and one week (Monday to Sunday). Its features describe:
- This week's weather (at inference time: the forecast for the coming week).
- Conditions before the week: 30 and 90 day precipitation, heat, dryness, soil wetness.
- Anomalies: how this week compares to that location's normal for the time of year,
  using the CLIMATOLOGY_YEARS only so the test years never shape the normals.
- Fire history: large fires in and around the county in earlier years only.
- Static facts: location, elevation, county size and population density.
- Time of year.
"""

import numpy as np
import pandas as pd

# Every feature the model uses, in model order. model.py checks inputs against this.
WEEK_FEATURES = [
    "week_tmax_mean",
    "week_tmax_max",
    "week_vpd_mean",
    "week_vpd_max",
    "week_rhmin_mean",
    "week_rhmin_min",
    "week_rh_mean",
    "week_wind_mean",
    "week_wind_max",
    "week_precip",
    "week_dry_days",
]
PRIOR_FEATURES = [
    "prior30_precip",
    "prior90_precip",
    "prior30_tmax_mean",
    "prior30_vpd_mean",
    "prior7_gwettop",
    "prior7_gwetroot",
    "days_since_rain",
]
# Anomalies are value minus the cell's normal for that week of the year. Precipitation
# anomalies are log ratios, because rainfall is skewed and its normal varies widely.
ANOMALY_SOURCES = {
    "week_tmax_mean": "diff",
    "week_vpd_mean": "diff",
    "week_rhmin_mean": "diff",
    "prior30_precip": "logratio",
    "prior90_precip": "logratio",
    "prior7_gwetroot": "diff",
}
ANOMALY_FEATURES = [f"{name}_anom" for name in ANOMALY_SOURCES]
HISTORY_FEATURES = [
    "hist_county_rate",
    "hist_county_density",
    "hist_50km_rate",
    "hist_100km_rate",
    "hist_100km_month_rate",
]
STATIC_FEATURES = ["lat", "lon", "elevation_m", "log_area_km2", "log_pop_density"]
SEASON_FEATURES = ["woy_sin", "woy_cos"]
FEATURES = (
    WEEK_FEATURES
    + PRIOR_FEATURES
    + ANOMALY_FEATURES
    + HISTORY_FEATURES
    + STATIC_FEATURES
    + SEASON_FEATURES
)

# Rain of at least this much in a day (mm) resets the dry spell counter. 2.5 mm
# (0.1 inch) is the usual "wetting rain" threshold in fire weather.
WETTING_RAIN_MM = 2.5
DRY_DAY_MM = 1.0
MAX_DRY_SPELL = 180


def _es(temp_c):
    """Saturation vapor pressure, by the Tetens formula.

    Args:
        temp_c: Temperature in C (number, array or DataFrame).
    Returns:
        Saturation vapor pressure in kPa, same shape as temp_c. At the dew point this
        is the actual vapor pressure, which is how VPD and afternoon humidity are
        derived from max temperature and dew point.
    Called by: weekly_weather_features.
    """
    return 0.6108 * np.exp(17.27 * temp_c / (temp_c + 237.3))


def weekly_weather_features(
    daily: dict[str, pd.DataFrame], week_starts: pd.DatetimeIndex
) -> pd.DataFrame:
    """Compute the week and antecedent weather features for many locations at once.

    Works on wide frames (one column per location) so each rolling window is computed
    for every location in one pass. "week_*" features cover the 7 days from the
    Monday through Sunday; "prior*" features and days_since_rain cover the days
    before the Monday, never the week itself. Afternoon VPD and humidity are derived
    from max temperature and the daily dew point.

    Args:
        daily: One wide DataFrame per NASA POWER parameter (T2M_MAX, T2MDEW, RH2M,
            WS10M_MAX, PRECTOTCORR, GWETTOP, GWETROOT): rows are dates, columns are
            locations (POWER cell ids). Missing dates are filled with NaN. Should
            cover 180 days before the first week (90 for the precipitation windows,
            180 for days_since_rain to reach its cap as in training) through the
            last week's Sunday.
        week_starts: Mondays to compute features for.
    Returns:
        Long DataFrame, one row per (week_start, location), with columns week_start,
        location and WEEK_FEATURES + PRIOR_FEATURES as float32. A window with too
        many missing days (fewer than 5 of 7, or under 80% of a prior window) gives
        NaN, which XGBoost handles as missing.
    Called by: build_dataset.build (all cells, all weeks) and
    model.WildfireModel.features_for_week (one week, at inference).
    """
    index = pd.date_range(min(f.index.min() for f in daily.values()), max(f.index.max() for f in daily.values()))
    d = {name: frame.reindex(index) for name, frame in daily.items()}
    tmax, dew, precip = d["T2M_MAX"], d["T2MDEW"], d["PRECTOTCORR"]
    es_tmax, ea = _es(tmax), _es(dew)
    vpd = (es_tmax - ea).clip(lower=0)  # Afternoon vapor pressure deficit (kPa)
    rhmin = (100 * ea / es_tmax).clip(0, 100)  # Afternoon relative humidity (%)

    def forward(frame: pd.DataFrame, how: str) -> pd.DataFrame:
        """Statistic over the 7 days starting on each date.

        Args:
            frame: Wide daily frame (dates x locations).
            how: Rolling method name: "mean", "max", "min" or "sum".
        Returns:
            Same-shaped frame; the value on a Monday describes Monday-Sunday.
        """
        rolled = getattr(frame.rolling(7, min_periods=5), how)()
        return rolled.shift(-6)

    def before(frame: pd.DataFrame, days: int, how: str) -> pd.DataFrame:
        """Statistic over the `days` days ending the day before each date.

        Args:
            frame: Wide daily frame (dates x locations).
            days: Window length.
            how: Rolling method name: "mean", "max", "min" or "sum".
        Returns:
            Same-shaped frame; the value on a Monday excludes that Monday.
        """
        rolled = getattr(frame.rolling(days, min_periods=int(days * 0.8)), how)()
        return rolled.shift(1)

    # Consecutive days without wetting rain, through the day before each date.
    # Missing days count as dry (NaN >= 2.5 is False); POWER gaps are rare.
    rain = (precip >= WETTING_RAIN_MM).to_numpy()
    spell = pd.DataFrame(_run_length(~rain), index=index, columns=precip.columns)
    spell = spell.clip(upper=MAX_DRY_SPELL).shift(1)

    features = {
        "week_tmax_mean": forward(tmax, "mean"),
        "week_tmax_max": forward(tmax, "max"),
        "week_vpd_mean": forward(vpd, "mean"),
        "week_vpd_max": forward(vpd, "max"),
        "week_rhmin_mean": forward(rhmin, "mean"),
        "week_rhmin_min": forward(rhmin, "min"),
        "week_rh_mean": forward(d["RH2M"], "mean"),
        "week_wind_mean": forward(d["WS10M_MAX"], "mean"),
        "week_wind_max": forward(d["WS10M_MAX"], "max"),
        "week_precip": forward(precip, "sum"),
        "week_dry_days": forward((precip < DRY_DAY_MM).astype("float32").where(precip.notna()), "sum"),
        "prior30_precip": before(precip, 30, "sum"),
        "prior90_precip": before(precip, 90, "sum"),
        "prior30_tmax_mean": before(tmax, 30, "mean"),
        "prior30_vpd_mean": before(vpd, 30, "mean"),
        "prior7_gwettop": before(d["GWETTOP"], 7, "mean"),
        "prior7_gwetroot": before(d["GWETROOT"], 7, "mean"),
        "days_since_rain": spell,
    }
    week_starts = pd.DatetimeIndex(week_starts)
    long = {
        name: frame.reindex(week_starts).stack(future_stack=True)
        for name, frame in features.items()
    }
    out = pd.DataFrame(long)
    out.index.names = ["week_start", "location"]
    return out.reset_index().astype({name: "float32" for name in features})


def _run_length(dry: np.ndarray) -> np.ndarray:
    """Count, per column, the consecutive True values ending at each row.

    Args:
        dry: 2-D boolean array (dates x locations), True on days without wetting rain.
    Returns:
        float32 array of the same shape: the dry spell length through each day,
        resetting to 0 on a rain day. Spells already running at the first row start
        counting from there, so callers need enough history before the dates they
        read.
    Called by: weekly_weather_features, for days_since_rain.
    """
    out = np.zeros(dry.shape, dtype="float32")
    current = np.zeros(dry.shape[1], dtype="float32")
    for i in range(dry.shape[0]):
        current = np.where(dry[i], current + 1, 0)
        out[i] = current
    return out


def week_of_year(week_starts: pd.Series) -> pd.Series:
    """Get each week's ISO week number, folding week 53 into 52.

    Week 53 only occurs in some years, so it's merged into 52 to give it a
    climatology normal.

    Args:
        week_starts: Week start dates (Series of timestamps).
    Returns:
        int16 Series of week numbers 1-52, same index as week_starts.
    Called by: season_features, build_climatology, add_anomalies.
    """
    return pd.to_datetime(week_starts).dt.isocalendar().week.astype("int16").clip(upper=52)


def season_features(week_starts: pd.Series) -> pd.DataFrame:
    """Encode the time of year as a point on a circle.

    Sine and cosine of the week number make week 52 sit next to week 1, which a
    plain week number wouldn't.

    Args:
        week_starts: Week start dates (Series of timestamps).
    Returns:
        float32 DataFrame with woy_sin and woy_cos, same index as week_starts.
    Called by: build_dataset.build, model.WildfireModel.features_for_week.
    """
    angle = 2 * np.pi * (week_of_year(week_starts) - 1) / 52
    return pd.DataFrame({"woy_sin": np.sin(angle), "woy_cos": np.cos(angle)}, index=week_starts.index).astype("float32")


def build_climatology(weather: pd.DataFrame, years: range) -> pd.DataFrame:
    """Compute each location's normal for the anomaly source features, by week of year.

    Averages only the given years, so test-year weather never shapes the normals.
    With about nine years per week the raw averages are noisy, so each week is
    smoothed with the two weeks either side, wrapping around the new year.

    Args:
        weather: Output of weekly_weather_features (week_start, location, features).
        years: ISO years to average over (config.CLIMATOLOGY_YEARS).
    Returns:
        float32 DataFrame indexed by (location, woy), woy 1-52, with one column per
        ANOMALY_SOURCES key.
    Called by: build_dataset.build, which saves it as climatology.parquet for
    inference.
    """
    sample = weather[pd.to_datetime(weather["week_start"]).dt.isocalendar().year.isin(list(years))]
    sample = sample.assign(woy=week_of_year(sample["week_start"]).to_numpy())
    means = sample.groupby(["location", "woy"])[list(ANOMALY_SOURCES)].mean()
    smoothed = []
    for location, frame in means.groupby(level="location"):
        frame = frame.droplevel("location").reindex(range(1, 53))
        wrapped = pd.concat([frame.iloc[-2:], frame, frame.iloc[:2]])
        rolled = wrapped.rolling(5, center=True, min_periods=1).mean().iloc[2:-2]
        rolled.index = pd.MultiIndex.from_product([[location], rolled.index], names=["location", "woy"])
        smoothed.append(rolled)
    return pd.concat(smoothed).astype("float32")


def add_anomalies(weather: pd.DataFrame, climatology: pd.DataFrame) -> pd.DataFrame:
    """Add the *_anom columns: how far each value is from its location's normal.

    "diff" sources get value minus normal. "logratio" sources (precipitation) get
    log((value + 5) / (normal + 5)); the +5 mm keeps dry places and dry seasons from
    producing huge ratios.

    Args:
        weather: Output of weekly_weather_features. Modified in place.
        climatology: Output of build_climatology (or artifacts/climatology.parquet).
            Locations missing from it get NaN anomalies.
    Returns:
        The same weather DataFrame, with ANOMALY_FEATURES columns added (float32).
    Called by: build_dataset.build, model.WildfireModel.features_for_week.
    """
    keys = pd.MultiIndex.from_arrays([weather["location"], week_of_year(weather["week_start"])])
    normals = climatology.reindex(keys)
    for name, kind in ANOMALY_SOURCES.items():
        value, normal = weather[name].to_numpy(), normals[name].to_numpy()
        if kind == "logratio":
            weather[f"{name}_anom"] = np.log((value + 5) / (normal + 5))
        else:
            weather[f"{name}_anom"] = value - normal
        weather[f"{name}_anom"] = weather[f"{name}_anom"].astype("float32")
    return weather


def fire_history(
    counties: pd.DataFrame, fires: pd.DataFrame, years: range, history_start: int
) -> pd.DataFrame:
    """Count large fires in and around each county, using only years before each target year.

    Fires are counted per county, year and month: inside the county (by fips), and
    within 50 km and 100 km of its centroid (haversine distance, computed 256
    counties at a time). Cumulative sums over years then give "fires before year Y"
    for each target year without recounting.

    Args:
        counties: Indexed by fips, with lat, lon and area_km2.
        fires: MTBS fires with ig_date, latitude, longitude and fips (county containing
            the ignition point, or None).
        years: Target years. Year Y's features count fires from history_start to Y-1.
        history_start: First year of fire records.
    Returns:
        float32 DataFrame indexed by (fips, year, month) with HISTORY_FEATURES. Rates
        are fires per year of record (Y - history_start). hist_county_density is
        hist_county_rate per 1,000 km2. hist_100km_month_rate counts only fires in
        that calendar month, which captures each area's fire season; the other
        features repeat across the 12 months of a year.
    Raises:
        ValueError: If a target year isn't after history_start.
    Called by: build_dataset.build, for the training years and again for
    LAST_YEAR + 1 (saved as history_latest.parquet for inference).
    """
    years = list(years)
    fire_year = fires["ig_date"].dt.year.to_numpy()
    fire_month = fires["ig_date"].dt.month.to_numpy()
    year_slot = fire_year - history_start
    n_years = max(years) - history_start  # Slots for history_start .. max(years)-1
    keep = (year_slot >= 0) & (year_slot < n_years)
    fires, fire_month, year_slot = fires[keep], fire_month[keep], year_slot[keep]

    n_counties = len(counties)
    near50 = np.zeros((n_counties, n_years, 12), dtype="float32")
    near100 = np.zeros((n_counties, n_years, 12), dtype="float32")
    lat1 = np.radians(counties["lat"].to_numpy())[:, None]
    lon1 = np.radians(counties["lon"].to_numpy())[:, None]
    lat2 = np.radians(fires["latitude"].to_numpy())[None, :]
    lon2 = np.radians(fires["longitude"].to_numpy())[None, :]
    for start in range(0, n_counties, 256):
        sl = slice(start, start + 256)
        a = (
            np.sin((lat2 - lat1[sl]) / 2) ** 2
            + np.cos(lat1[sl]) * np.cos(lat2) * np.sin((lon2 - lon1[sl]) / 2) ** 2
        )
        km = 2 * 6371 * np.arcsin(np.sqrt(a))
        for radius, target in ((50, near50), (100, near100)):
            rows, cols = np.nonzero(km <= radius)
            np.add.at(target, (rows + start, year_slot[cols], fire_month[cols] - 1), 1)

    in_county = np.zeros((n_counties, n_years), dtype="float32")
    position = pd.Series(np.arange(n_counties), index=counties.index)
    matched = fires["fips"].isin(position.index).to_numpy()
    np.add.at(in_county, (position[fires["fips"][matched]].to_numpy(), year_slot[matched]), 1)

    # Cumulative counts through each year, then read "through Y-1" for target year Y.
    cum_county = np.cumsum(in_county, axis=1)
    cum50 = np.cumsum(near50.sum(axis=2), axis=1)
    cum100 = np.cumsum(near100.sum(axis=2), axis=1)
    cum100_month = np.cumsum(near100, axis=1)

    area = counties["area_km2"].to_numpy()
    parts = []
    for year in years:
        slot = year - history_start - 1
        record_years = year - history_start
        if slot < 0:
            raise ValueError("Target years must come after history_start")
        base = {
            "hist_county_rate": cum_county[:, slot] / record_years,
            "hist_county_density": cum_county[:, slot] / record_years / np.maximum(area, 1) * 1000,
            "hist_50km_rate": cum50[:, slot] / record_years,
            "hist_100km_rate": cum100[:, slot] / record_years,
        }
        for month in range(1, 13):
            frame = pd.DataFrame(base, index=counties.index)
            frame["hist_100km_month_rate"] = cum100_month[:, slot, month - 1] / record_years
            frame["year"], frame["month"] = year, month
            parts.append(frame)
    history = pd.concat(parts).reset_index().set_index(["fips", "year", "month"])
    return history.astype("float32")


def static_features(counties: pd.DataFrame, elevation: pd.Series) -> pd.DataFrame:
    """Build the features that don't change from week to week.

    Args:
        counties: From sources.load_counties (indexed by fips, with lat, lon,
            population and area_km2).
        elevation: From sources.load_elevations, indexed by fips.
    Returns:
        float32 DataFrame indexed by fips with STATIC_FEATURES: lat, lon,
        elevation_m, log_area_km2 (bigger counties have more chances of a fire), and
        log_pop_density (log of 1 + people per km2; most ignitions are human-caused).
    Called by: build_dataset.build, which also saves it as county_static.parquet.
    """
    area = counties["area_km2"].clip(lower=1)
    return pd.DataFrame(
        {
            "lat": counties["lat"],
            "lon": counties["lon"],
            "elevation_m": elevation.reindex(counties.index),
            "log_area_km2": np.log(area),
            "log_pop_density": np.log1p(counties["population"] / area),
        },
        index=counties.index,
    ).astype("float32")


def week_month(week_starts: pd.Series) -> pd.Series:
    """Get the month each week belongs to: the calendar month of its Thursday.

    Args:
        week_starts: Week start dates (Series of timestamps).
    Returns:
        int8 Series of months 1-12, same index as week_starts. Used to pick the
        hist_100km_month_rate row.
    Called by: build_dataset.build, model.WildfireModel.features_for_week,
    train.train (baseline), notebooks/01_data.ipynb and 02_train_evaluate.ipynb.
    """
    return (pd.to_datetime(week_starts) + pd.Timedelta(days=3)).dt.month.astype("int8")


def week_year(week_starts: pd.Series) -> pd.Series:
    """Get each week's ISO year (the year of its Thursday).

    Splits and fire history use it, so a week spanning New Year's belongs to exactly
    one year and no week straddles two splits.

    Args:
        week_starts: Week start dates (Series of timestamps).
    Returns:
        int16 Series of years, same index as week_starts.
    Called by: build_dataset.build.
    """
    return pd.to_datetime(week_starts).dt.isocalendar().year.astype("int16")

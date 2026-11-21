"""Loads the trained wildfire model and scores county-weeks.

Usage:
    model = WildfireModel.load()
    X = model.features_for_week(daily, week_start)   # one row per county
    probability = model.predict(X)                   # calibrated weekly probability
    contributions = model.explain(X)                 # per-feature push up or down

`daily` holds one wide DataFrame per NASA POWER parameter (see
sources.POWER_PARAMETERS): rows are dates from 180 days before week_start through
week_start + 6, columns are NASA POWER cell ids (artifacts/county_cells.parquet).
The days before the week are observed weather; the week itself is the forecast.
180 days lets days_since_rain reach the same cap as in training; the other
features need 90.
"""

import json
from pathlib import Path

import numpy as np
import pandas as pd
import xgboost as xgb
from scipy.interpolate import interp1d

from ml.wildfire import features as F
from ml.wildfire.config import ARTIFACTS_DIR


class WildfireModel:
    """The trained booster, its isotonic calibration and the inference lookup tables.

    Used by: the backend (step 2), and anything else that scores county-weeks.
    """

    def __init__(self, directory: Path):
        """Load every artifact train.py wrote.

        Args:
            directory: Folder holding model.json, calibration.json, metadata.json and
                the lookup parquet files.
        Raises:
            FileNotFoundError: If an artifact is missing (run train.py first).
        Called by: load.
        """
        self.directory = directory
        self.metadata = json.loads((directory / "metadata.json").read_text(encoding="utf-8"))
        self.features: list[str] = self.metadata["features"]
        self.booster = xgb.Booster()
        self.booster.load_model(directory / "model.json")
        calibration = json.loads((directory / "calibration.json").read_text(encoding="utf-8"))
        # float32, like the fitted sklearn calibrator, so results match it bit for bit.
        self._cal_x = np.asarray(calibration["x"], dtype=np.float32)
        self._cal_y = np.asarray(calibration["y"], dtype=np.float32)
        self._cal_f = interp1d(self._cal_x, self._cal_y, kind="linear", bounds_error=False)
        self.climatology = pd.read_parquet(directory / "climatology.parquet")
        self.history = pd.read_parquet(directory / "history_latest.parquet")
        self.static = pd.read_parquet(directory / "county_static.parquet")
        self.county_cells = pd.read_parquet(directory / "county_cells.parquet")

    @classmethod
    def load(cls, directory: Path = ARTIFACTS_DIR) -> "WildfireModel":
        """Load the model from ml/wildfire/artifacts/ (or another folder).

        Args:
            directory: Artifacts folder. Defaults to config.ARTIFACTS_DIR.
        Returns:
            A ready WildfireModel. Load once at startup and reuse it.
        Called by: the backend (step 2), notebooks/02_train_evaluate.ipynb and
        notebooks/03_predict.ipynb.
        """
        return cls(directory)

    def _matrix(self, X: pd.DataFrame) -> xgb.DMatrix:
        """Put features in model order and wrap them for XGBoost.

        Args:
            X: DataFrame containing at least every model feature (extra columns
                are ignored). NaN is treated as missing.
        Returns:
            xgb.DMatrix with the features in the order the model was trained on.
        Raises:
            ValueError: If a feature column is missing.
        Called by: predict_raw, explain.
        """
        missing = [name for name in self.features if name not in X.columns]
        if missing:
            raise ValueError(f"Missing features: {missing}")
        return xgb.DMatrix(X[self.features])

    def predict_raw(self, X: pd.DataFrame) -> np.ndarray:
        """Score rows with the booster alone, without calibration.

        These scores are inflated by scale_pos_weight, so they rank counties
        correctly but aren't probabilities.

        Args:
            X: Feature DataFrame (see _matrix).
        Returns:
            Array of raw scores between 0 and 1, one per row.
        Called by: predict, notebooks/02_train_evaluate.ipynb.
        """
        return self.booster.predict(self._matrix(X))

    def calibrate(self, raw: np.ndarray) -> np.ndarray:
        """Map raw scores to real probabilities with the isotonic fit.

        Repeats sklearn's IsotonicRegression.predict (out_of_bounds="clip") step by
        step: clip to the threshold range, interpolate linearly with scipy, and
        cast back to the input's dtype. That reproduces the calibrator train.py
        evaluated exactly. np.interp would differ by float rounding (about 1e-7),
        which is enough to break ties differently and shift PR-AUC in the third
        decimal.

        Args:
            raw: Raw scores from predict_raw.
        Returns:
            Calibrated weekly probabilities, same shape and dtype as raw (float32
            from predict_raw).
        Called by: predict, and notebooks/02_train_evaluate.ipynb.
        """
        raw = np.asarray(raw)
        clipped = np.clip(raw, self._cal_x[0], self._cal_x[-1])
        return self._cal_f(clipped).astype(raw.dtype)

    def predict(self, X: pd.DataFrame) -> np.ndarray:
        """Estimate the probability that a large wildfire ignites in each county that week.

        Args:
            X: Feature DataFrame, e.g. from features_for_week.
        Returns:
            Array of calibrated probabilities, one per row.
        Called by: the backend (step 2), notebooks/03_predict.ipynb.
        """
        return self.calibrate(self.predict_raw(X))

    def explain(self, X: pd.DataFrame) -> pd.DataFrame:
        """Break each prediction down into per-feature contributions (SHAP values).

        Values are in log-odds of the raw model. Positive values push the
        probability up. Calibration is monotonic, so the ranking of drivers carries
        over to the calibrated probability. A row's values plus `bias` sum to its
        raw log-odds.

        Args:
            X: Feature DataFrame (see _matrix).
        Returns:
            DataFrame with the same index as X, one column per feature plus `bias`
            (the model's average log-odds).
        Called by: the backend (step 2), to show what's raising a county's score;
        notebooks/03_predict.ipynb.
        """
        values = self.booster.predict(self._matrix(X), pred_contribs=True)
        return pd.DataFrame(values, index=X.index, columns=[*self.features, "bias"])

    def features_for_week(
        self, daily: dict[str, pd.DataFrame], week_start: pd.Timestamp
    ) -> pd.DataFrame:
        """Build the feature row for every county for one week.

        Computes weather features and anomalies per POWER cell, then gives each
        county its cell's weather, its fire history for the week's month (fires
        through the last full MTBS year), its static features and the season.

        Args:
            daily: Wide daily weather per POWER parameter, columns are cell ids,
                covering week_start - 180 days through week_start + 6 days.
                Counties whose cell is missing get NaN weather features.
            week_start: The Monday the week starts.
        Returns:
            DataFrame indexed by fips with every model feature, in model order.
        Raises:
            ValueError: If week_start isn't a Monday.
        Called by: the backend (step 2), before predict and explain;
        notebooks/03_predict.ipynb.
        """
        week_start = pd.Timestamp(week_start).normalize()
        if week_start.weekday() != 0:
            raise ValueError("week_start must be a Monday")
        weather = F.weekly_weather_features(daily, pd.DatetimeIndex([week_start]))
        F.add_anomalies(weather, self.climatology)
        weather = weather.set_index("location").drop(columns="week_start")

        rows = self.county_cells[["cell"]].join(weather, on="cell")
        month = int(F.week_month(pd.Series([week_start])).iloc[0])
        history = self.history.xs(month, level="month")
        rows = rows.join(history).join(self.static)
        season = F.season_features(pd.Series([week_start] * len(rows), index=rows.index))
        rows = rows.join(season)
        return rows[self.features]

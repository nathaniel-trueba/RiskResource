"""Paths, date ranges and split years for the wildfire model."""

from datetime import date
from pathlib import Path

ML_DIR = Path(__file__).resolve().parent
BACKEND_DIR = ML_DIR.parent.parent

# Downloaded upstream data and the built dataset. Git-ignored and rebuildable.
DATA_DIR = ML_DIR / "data"
RAW_DIR = DATA_DIR / "raw"
POWER_DIR = RAW_DIR / "power"  # One parquet file per NASA POWER grid cell
DATASET_PATH = DATA_DIR / "county_weeks.parquet"

# What train.py produces and the backend will load: the model, calibrator and
# everything needed to build features the same way at inference time.
ARTIFACTS_DIR = ML_DIR / "artifacts"

REFERENCE_PATH = BACKEND_DIR / "data" / "reference.json"
USER_AGENT = "UCSD-Risk-Resource-NotForProfit"

# Fire history counts from MTBS's first year. Only years before a row's year are
# used, so history features never see the row's own year or anything after it.
HISTORY_START_YEAR = 1984

# Rows are county-weeks whose Monday falls in these years. MTBS publishes a year's
# fires about a year later, so the latest full year is the one before last.
FIRST_YEAR = 2010
LAST_YEAR = 2024
# Weather starts early enough to fill the 90-day antecedent windows of the first week.
WEATHER_START = date(2009, 9, 1)
WEATHER_END = date(LAST_YEAR, 12, 31)

# Time-based splits. Everything the model learns from (fitting, early stopping,
# calibration and climatology) comes from 2010-2020; 2021 onward is test only.
FIT_YEARS = range(2010, 2018)  # First fit, to pick the number of trees
EARLY_STOP_YEARS = range(2018, 2019)
REFIT_YEARS = range(2010, 2019)  # Final model, refit with that number of trees
CALIBRATION_YEARS = range(2019, 2021)  # Isotonic calibration
TEST_YEARS = range(2021, LAST_YEAR + 1)
# Climatology used for the anomaly features: the refit years only.
CLIMATOLOGY_YEARS = REFIT_YEARS

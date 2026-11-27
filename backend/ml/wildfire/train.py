"""Trains, calibrates and evaluates the wildfire ignition model.

Run from backend/ after build_dataset.py:  python -m ml.wildfire.train

Steps, all split by ISO year so nothing from a later period is used earlier:
1. Fit on FIT_YEARS (2010-2017), early stopping on EARLY_STOP_YEARS (2018) with
   eval_metric="aucpr", to choose the number of trees.
2. Refit on REFIT_YEARS (2010-2018) with that many trees.
3. Fit isotonic regression on CALIBRATION_YEARS (2019-2020). Fire rows are weighted
   by scale_pos_weight = negatives / positives in the training rows, which inflates
   the raw probabilities; calibration maps them back to real weekly probabilities.
4. Evaluate on TEST_YEARS (2021 onward), which nothing above has seen.

Writes the model, calibrator, lookup tables and metrics to ml/wildfire/artifacts/.
"""

import argparse
import json
import logging
import shutil
import time
from datetime import UTC, datetime

import numpy as np
import pandas as pd
import xgboost as xgb
from sklearn.isotonic import IsotonicRegression
from sklearn.metrics import average_precision_score, brier_score_loss, log_loss, roc_auc_score

from ml.wildfire.config import (
    ARTIFACTS_DIR,
    CALIBRATION_YEARS,
    DATA_DIR,
    DATASET_PATH,
    EARLY_STOP_YEARS,
    FIT_YEARS,
    REFIT_YEARS,
    TEST_YEARS,
)
from ml.wildfire.features import FEATURES, week_month

logger = logging.getLogger(__name__)

PARAMS = {
    "objective": "binary:logistic",
    "eval_metric": "aucpr",
    "tree_method": "hist",
    "learning_rate": 0.03,
    "max_depth": 6,
    "min_child_weight": 5,
    "subsample": 0.8,
    "colsample_bytree": 0.8,
    "reg_lambda": 1.0,
    "n_jobs": -1,
}
MAX_TREES = 3000
EARLY_STOPPING_ROUNDS = 150
LOOKUP_TABLES = ("climatology.parquet", "history_latest.parquet", "county_static.parquet", "county_cells.parquet")


def pos_weight(y: pd.Series) -> float:
    """Compute scale_pos_weight: the ratio of no-fire to fire rows.

    Args:
        y: 0/1 labels of the rows the model is fit on.
    Returns:
        (y == 0).sum() / (y == 1).sum().
    Called by: train, for the stage 1 fit and the refit separately.
    """
    return float((y == 0).sum() / (y == 1).sum())


def metrics(y: np.ndarray, p: np.ndarray) -> dict:
    """Score one set of predictions on ranking and on probability quality.

    Args:
        y: 0/1 labels.
        p: Predicted probabilities (or any scores, for the ranking metrics).
    Returns:
        Dict with pr_auc (average precision, the main metric for rare events),
        roc_auc, brier, log_loss (both only meaningful for calibrated
        probabilities), mean_predicted vs observed_rate, precision_top1pct (fire
        rate among the top 1% of rows) and recall_top5pct (share of fires caught by
        the top 5%).
    Called by: train, for the test set (calibrated, raw and baseline), the
    calibration set and each test year.
    """
    order = np.argsort(-p)
    top1 = order[: max(1, len(p) // 100)]
    top5 = order[: max(1, len(p) // 20)]
    return {
        "pr_auc": float(average_precision_score(y, p)),
        "roc_auc": float(roc_auc_score(y, p)),
        "brier": float(brier_score_loss(y, p)),
        "log_loss": float(log_loss(y, np.clip(p, 1e-7, 1 - 1e-7))),
        "mean_predicted": float(p.mean()),
        "observed_rate": float(y.mean()),
        "precision_top1pct": float(y[top1].mean()),
        "recall_top5pct": float(y[top5].sum() / max(1, y.sum())),
    }


def reliability(y: np.ndarray, p: np.ndarray) -> list[dict]:
    """Compare predicted and observed fire rates in bins of predicted probability.

    A well-calibrated model has mean_predicted close to observed_rate in every bin.
    The bins are logarithmic because most predictions are tiny.

    Args:
        y: 0/1 labels.
        p: Calibrated probabilities.
    Returns:
        List of dicts (one per non-empty bin) with bin, rows, fires, mean_predicted
        and observed_rate.
    Called by: train, for the test set.
    """
    edges = [0, 1e-4, 3e-4, 1e-3, 3e-3, 1e-2, 3e-2, 1e-1, 1.0001]
    bins = np.digitize(p, edges) - 1
    out = []
    for b in range(len(edges) - 1):
        mask = bins == b
        if mask.any():
            out.append(
                {
                    "bin": f"[{edges[b]:g}, {min(edges[b + 1], 1):g})",
                    "rows": int(mask.sum()),
                    "fires": int(y[mask].sum()),
                    "mean_predicted": float(p[mask].mean()),
                    "observed_rate": float(y[mask].mean()),
                }
            )
    return out


def train() -> dict:
    """Run the four steps in the module docstring and save the artifacts.

    Returns:
        The metrics dict that's also saved in artifacts/metadata.json: test metrics
        for the calibrated model, the raw model and the county-month baseline,
        calibration-set metrics, a reliability table, the early-stopping PR-AUC
        curve and per-year test metrics.
    Raises:
        FileNotFoundError: If build_dataset.py hasn't been run.
    Called by: main, and notebooks/02_train_evaluate.ipynb when RETRAIN is True.
    """
    started = time.time()
    data = pd.read_parquet(DATASET_PATH)
    logger.info("Loaded %d rows, %d fires", len(data), data["fire"].sum())

    def split(years: range) -> tuple[pd.DataFrame, pd.Series]:
        """Select the rows whose ISO year is in `years`, as (features, labels)."""
        part = data[data["year"].isin(list(years))]
        return part[FEATURES], part["fire"]

    X_fit, y_fit = split(FIT_YEARS)
    X_es, y_es = split(EARLY_STOP_YEARS)
    X_refit, y_refit = split(REFIT_YEARS)
    X_cal, y_cal = split(CALIBRATION_YEARS)
    X_test, y_test = split(TEST_YEARS)
    for name, y in (("fit", y_fit), ("early stop", y_es), ("refit", y_refit),
                    ("calibration", y_cal), ("test", y_test)):
        logger.info("%-12s %9d rows, %5d fires (%.4f%%)", name, len(y), y.sum(), 100 * y.mean())

    # 1. Choose the number of trees.
    ratio_fit = pos_weight(y_fit)
    logger.info("Stage 1: fit 2010-2017, scale_pos_weight=%.1f", ratio_fit)
    search = xgb.XGBClassifier(
        **PARAMS, n_estimators=MAX_TREES, scale_pos_weight=ratio_fit,
        early_stopping_rounds=EARLY_STOPPING_ROUNDS,
    )
    search.fit(X_fit, y_fit, eval_set=[(X_es, y_es)], verbose=200)
    n_trees = search.best_iteration + 1
    logger.info("Best iteration %d, early-stop PR-AUC %.4f", n_trees, search.best_score)

    # 2. Refit on all pre-calibration years.
    ratio = pos_weight(y_refit)
    logger.info("Stage 2: refit 2010-2018 with %d trees, scale_pos_weight=%.1f", n_trees, ratio)
    model = xgb.XGBClassifier(**PARAMS, n_estimators=n_trees, scale_pos_weight=ratio)
    model.fit(X_refit, y_refit, verbose=False)

    # 3. Calibrate on 2019-2020.
    raw_cal = model.predict_proba(X_cal)[:, 1]
    calibrator = IsotonicRegression(y_min=0.0, y_max=1.0, out_of_bounds="clip")
    calibrator.fit(raw_cal, y_cal)

    # 4. Evaluate on 2021+.
    raw_test = model.predict_proba(X_test)[:, 1]
    cal_test = calibrator.predict(raw_test)
    y_np = y_test.to_numpy()

    # Baseline to beat: each county's fire rate for the month in 2010-2020.
    train_rows = data[data["year"] <= max(CALIBRATION_YEARS)]
    climatology = train_rows.groupby(
        [train_rows["fips"], week_month(train_rows["week_start"])]
    )["fire"].mean()
    test_rows = data[data["year"].isin(list(TEST_YEARS))]
    baseline_keys = pd.MultiIndex.from_arrays([test_rows["fips"], week_month(test_rows["week_start"])])
    baseline = climatology.reindex(baseline_keys).fillna(0).to_numpy()

    results = {
        "test_years": [min(TEST_YEARS), max(TEST_YEARS)],
        "calibrated": metrics(y_np, cal_test),
        "raw": metrics(y_np, raw_test),
        "baseline_county_month_rate": metrics(y_np, baseline),
        "calibration_set_calibrated": metrics(y_cal.to_numpy(), calibrator.predict(raw_cal)),
        "reliability_test": reliability(y_np, cal_test),
        # PR-AUC on the early-stopping year after each tree of the stage 1 fit.
        "early_stopping_aucpr": [float(v) for v in search.evals_result()["validation_0"]["aucpr"]],
        "test_by_year": {
            int(year): metrics(y_np[mask], cal_test[mask])
            for year in TEST_YEARS
            if (mask := (test_rows["year"] == year).to_numpy()).any()
        },
    }

    # Explanations: mean |SHAP| (log-odds contribution) over a test sample.
    sample = X_test.sample(min(200_000, len(X_test)), random_state=0)
    contribs = model.get_booster().predict(xgb.DMatrix(sample), pred_contribs=True)[:, :-1]
    importance = pd.DataFrame(
        {
            "mean_abs_shap": np.abs(contribs).mean(axis=0),
            "gain": pd.Series(model.get_booster().get_score(importance_type="gain")).reindex(FEATURES).fillna(0).to_numpy(),
        },
        index=FEATURES,
    ).sort_values("mean_abs_shap", ascending=False)

    save(model, calibrator, results, importance, n_trees, ratio, ratio_fit, y_refit, y_cal)
    logger.info("Test metrics (calibrated):\n%s", json.dumps(results["calibrated"], indent=2))
    logger.info("Baseline (county-month rate):\n%s", json.dumps(results["baseline_county_month_rate"], indent=2))
    logger.info("Reliability on test:\n%s", pd.DataFrame(results["reliability_test"]).to_string(index=False))
    logger.info("Top features:\n%s", importance.head(15).to_string())
    logger.info("Done in %.0fs", time.time() - started)
    return results


def save(model, calibrator, results, importance, n_trees, ratio, ratio_fit, y_refit, y_cal) -> None:
    """Write everything inference needs, plus the metrics, to ARTIFACTS_DIR.

    Args:
        model: The refit XGBClassifier.
        calibrator: The fitted IsotonicRegression. Saved as its thresholds in JSON.
        results: Metrics dict from train.
        importance: DataFrame of mean |SHAP| and gain per feature.
        n_trees: Number of trees chosen by early stopping.
        ratio: scale_pos_weight of the refit.
        ratio_fit: scale_pos_weight of the stage 1 fit.
        y_refit: Labels of the refit rows (for the row and fire counts).
        y_cal: Labels of the calibration rows (for the row and fire counts).
    Returns:
        None. Writes model.json, calibration.json, feature_importance.csv,
        metadata.json, and copies the lookup tables from DATA_DIR.
    Called by: train.
    """
    ARTIFACTS_DIR.mkdir(parents=True, exist_ok=True)
    model.get_booster().save_model(ARTIFACTS_DIR / "model.json")
    # The isotonic step function as plain JSON, so inference needs no pickle.
    (ARTIFACTS_DIR / "calibration.json").write_text(
        json.dumps(
            {
                "method": "isotonic",
                "x": calibrator.X_thresholds_.tolist(),
                "y": calibrator.y_thresholds_.tolist(),
            }
        ),
        encoding="utf-8",
    )
    for name in LOOKUP_TABLES:
        shutil.copyfile(DATA_DIR / name, ARTIFACTS_DIR / name)
    importance.to_csv(ARTIFACTS_DIR / "feature_importance.csv", float_format="%.6g")
    metadata = {
        "trained_at": datetime.now(UTC).isoformat(timespec="seconds"),
        "target": "A large wildfire (MTBS: ~1,000+ acres West, ~500+ acres East) ignites in the county during the week (Monday-Sunday)",
        "features": FEATURES,
        "params": PARAMS,
        "n_trees": n_trees,
        "scale_pos_weight": ratio,
        "scale_pos_weight_stage1": ratio_fit,
        "splits": {
            "fit": [min(FIT_YEARS), max(FIT_YEARS)],
            "early_stop": [min(EARLY_STOP_YEARS), max(EARLY_STOP_YEARS)],
            "refit": [min(REFIT_YEARS), max(REFIT_YEARS)],
            "calibration": [min(CALIBRATION_YEARS), max(CALIBRATION_YEARS)],
            "test": [min(TEST_YEARS), max(TEST_YEARS)],
        },
        "training_rows": int(len(y_refit)),
        "training_fires": int(y_refit.sum()),
        "calibration_rows": int(len(y_cal)),
        "calibration_fires": int(y_cal.sum()),
        "metrics": results,
    }
    (ARTIFACTS_DIR / "metadata.json").write_text(json.dumps(metadata, indent=2), encoding="utf-8")
    logger.info("Saved artifacts to %s", ARTIFACTS_DIR)


def main() -> None:
    """Command-line entry point: set up logging and train.

    Called by: `python -m ml.wildfire.train`.
    """
    argparse.ArgumentParser(description=__doc__.splitlines()[0]).parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    train()


if __name__ == "__main__":
    main()

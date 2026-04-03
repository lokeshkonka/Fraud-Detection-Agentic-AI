"""
SHAP-based explainability and skew statistics.

Purpose
-------
Fraud blocks must be auditable. When the model flags a transaction, a bank analyst
or compliance officer needs a human-readable explanation. SHAP (SHapley Additive
exPlanations) provides per-feature attribution values that answer:

    "Which features pushed the fraud score above the threshold?"

Example output for a frozen account:
    +0.42  amount_to_org_balance_ratio   (transaction > 80% of sender's balance)
    +0.31  mean_shift_score              (z-score 4.2σ from normal behaviour)
    +0.21  is_large_transaction          (top-5% by transaction size)
    −0.07  variance_bucket=vlow          (small log-amount range — mild negative)

RBI compliance
--------------
SHAP values provide the "reasoning" required by RBI circular guidelines on
explainable AI in credit/payment fraud systems. Analysts can override model
decisions and the system logs the SHAP justification for every block/OTP action.

Skew statistics
---------------
IQR, mean, variance per numeric feature saved to artifacts/shap/skew_stats.csv
for drift monitoring baseline comparisons.
"""
from __future__ import annotations

from pathlib import Path
from typing import Dict

import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from sklearn.pipeline import Pipeline

try:
    import shap
    HAS_SHAP = True
except Exception:
    HAS_SHAP = False

plt.style.use("dark_background")

RNG_SEED = 42


def _to_dense(matrix):
    return matrix.toarray() if hasattr(matrix, "toarray") else matrix


def _select_shap_matrix(shap_values_obj, feature_count: int) -> np.ndarray:
    """Normalise the diverse SHAP output shapes into a 2-D (samples × features) array."""
    if isinstance(shap_values_obj, list):
        arr = shap_values_obj[1] if len(shap_values_obj) > 1 else shap_values_obj[0]
        return np.asarray(arr)

    arr = shap_values_obj.values if hasattr(shap_values_obj, "values") else np.asarray(shap_values_obj)
    if arr.ndim == 2:
        return arr
    if arr.ndim != 3:
        raise ValueError(f"Unexpected SHAP output rank: {arr.ndim}")

    feature_axes = [i for i, size in enumerate(arr.shape) if size == feature_count]
    if not feature_axes:
        raise ValueError(f"Cannot locate feature axis in SHAP shape {arr.shape} (feature_count={feature_count})")
    feature_axis = feature_axes[0]

    class_axes = [i for i, size in enumerate(arr.shape) if i != feature_axis and size in (1, 2)]
    class_axis = class_axes[0] if class_axes else [i for i in range(3) if i != feature_axis][0]
    class_index = 1 if arr.shape[class_axis] > 1 else 0
    arr2d = np.take(arr, class_index, axis=class_axis)

    feature_axis_after = feature_axis - 1 if class_axis < feature_axis else feature_axis
    return arr2d.T if feature_axis_after == 0 else arr2d


def shap_and_skew(
    models: Dict[str, Pipeline],
    X_test: pd.DataFrame,
    num_cols: list[str],
    artifact_dir: Path,
) -> None:
    """
    Generate SHAP summary plots for LR and RF, and save skew statistics.

    SHAP explainers used
    --------------------
    - LogisticRegression : shap.LinearExplainer  (fast, exact)
    - RandomForest       : shap.TreeExplainer     (fast, exact for trees)
    - XGBoost            : shap.TreeExplainer     (native SHAP support)

    Parameters
    ----------
    models      : dict of model_name → fitted sklearn Pipeline
    X_test      : test feature DataFrame
    num_cols    : numeric column names (for skew stats)
    artifact_dir: directory where plots and skew_stats.csv are written

    Saves
    -----
    artifacts/shap/skew_stats.csv
    artifacts/shap/shap_log_reg_summary.png
    artifacts/shap/shap_rf_summary.png
    """
    artifact_dir.mkdir(parents=True, exist_ok=True)

    # --- skew statistics ---
    stats = X_test[num_cols].agg(["mean", "var"]).T
    stats["iqr"] = X_test[num_cols].quantile(0.75) - X_test[num_cols].quantile(0.25)
    stats_path = artifact_dir / "skew_stats.csv"
    stats.to_csv(stats_path)
    print(f"Skew stats saved → {stats_path}")

    if not HAS_SHAP:
        readme = artifact_dir / "README.txt"
        readme.write_text("Install shap to compute SHAP values: pip install shap\n")
        print("shap not installed — wrote reminder to README.txt")
        return

    sample_size = min(5000, len(X_test))
    X_sample = X_test.sample(sample_size, random_state=RNG_SEED)

    # --- LR SHAP ---
    lr_model = models.get("lr")
    if lr_model is not None:
        lr_pre = lr_model.named_steps["preprocess"]
        X_enc_lr = _to_dense(lr_pre.transform(X_sample))
        try:
            explainer = shap.LinearExplainer(lr_model.named_steps["clf"], X_enc_lr)
            sv = _select_shap_matrix(explainer.shap_values(X_enc_lr), X_enc_lr.shape[1])
            shap.summary_plot(sv, X_enc_lr, show=False)
            plt.tight_layout()
            lr_path = artifact_dir / "shap_log_reg_summary.png"
            plt.savefig(lr_path)
            plt.close()
            print(f"LR SHAP summary saved → {lr_path}")
        except Exception as exc:
            plt.close("all")
            print(f"Skipping LR SHAP: {exc}")

    # --- RF SHAP ---
    rf_model = models.get("rf")
    if rf_model is not None:
        rf_pre = rf_model.named_steps["preprocess"]
        X_enc_rf = _to_dense(rf_pre.transform(X_sample))
        try:
            background = X_enc_rf[: min(200, len(X_enc_rf))]
            explainer = shap.TreeExplainer(rf_model.named_steps["clf"], data=background, feature_perturbation="interventional")
            sv = _select_shap_matrix(explainer.shap_values(X_enc_rf), X_enc_rf.shape[1])
            shap.summary_plot(sv, X_enc_rf, show=False)
            plt.tight_layout()
            rf_path = artifact_dir / "shap_rf_summary.png"
            plt.savefig(rf_path)
            plt.close()
            print(f"RF SHAP summary saved → {rf_path}")
        except Exception as exc:
            plt.close("all")
            print(f"Skipping RF SHAP: {exc}")

    # --- XGB SHAP ---
    xgb_model = models.get("xgb")
    if xgb_model is not None:
        xgb_pre = xgb_model.named_steps["preprocess"]
        X_enc_xgb = _to_dense(xgb_pre.transform(X_sample))
        try:
            explainer = shap.TreeExplainer(xgb_model.named_steps["clf"])
            sv = _select_shap_matrix(explainer.shap_values(X_enc_xgb), X_enc_xgb.shape[1])
            shap.summary_plot(sv, X_enc_xgb, show=False)
            plt.tight_layout()
            xgb_path = artifact_dir / "shap_xgb_summary.png"
            plt.savefig(xgb_path)
            plt.close()
            print(f"XGB SHAP summary saved → {xgb_path}")
        except Exception as exc:
            plt.close("all")
            print(f"Skipping XGB SHAP: {exc}")

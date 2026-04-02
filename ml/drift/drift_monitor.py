"""
Drift monitoring and drift baseline management.

What is drift?
--------------
Production data changes over time. Fraudsters adapt their tactics, customer
spending patterns shift with salary cycles, and economic conditions change.
If the model's training distribution no longer matches the live distribution,
prediction quality degrades — this is called data drift.

Drift metrics tracked
---------------------
fraud_prevalence : what fraction of transactions are labelled fraud
feature.mean     : per-feature mean (detects location shift)
feature.variance : per-feature variance (detects scale/spread shift)
feature.q1/q3    : IQR bounds (detects outlier distribution shift)
feature.outlier_ratio: fraction of values outside 1.5×IQR (detects tail shift)

Drift detection logic
---------------------
A new batch is compared to the stored baseline:
- If |new_mean - baseline_mean| / (baseline_std + ε) > threshold → mean drift
- If |new_variance / baseline_variance - 1| > threshold → variance drift
- If |new_fraud_prevalence - baseline_prevalence| > 0.003 → prevalence drift

Retraining policy
-----------------
Retraining is scheduled every 7 days OR immediately triggered when:
- Fraud prevalence drifts > 0.3 percentage points
- Any feature mean shifts > 2 standard deviations from baseline
- Any feature variance changes > 20%

Champion–Challenger promotion
------------------------------
A new (challenger) model is trained on the latest 7-day window.
The challenger is promoted to champion only if:
    challenger.pr_auc > champion.pr_auc  AND
    challenger.precision_top1pct >= champion.precision_top1pct - 0.01
This prevents degrading live-serving precision for marginal AUC gains.
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pandas as pd


def compute_drift_baseline(df: pd.DataFrame, artifact_dir: Path) -> None:
    """
    Compute and persist the drift baseline from a training DataFrame.

    Stored statistics are later used by detect_drift() to compare against
    new production batches and decide whether retraining should be triggered.

    Parameters
    ----------
    df          : feature-engineered training DataFrame (includes 'is_fraud')
    artifact_dir: directory where drift_baseline.json is written

    Saves
    -----
    artifacts/drift/drift_baseline.json
    """
    artifact_dir.mkdir(parents=True, exist_ok=True)
    num_cols = [c for c in df.columns if pd.api.types.is_numeric_dtype(df[c]) and c != "is_fraud"]
    baseline: dict = {"fraud_prevalence": float(df["is_fraud"].mean()), "features": {}}

    for col in num_cols:
        q1, q3 = df[col].quantile([0.25, 0.75])
        iqr = q3 - q1
        lower, upper = q1 - 1.5 * iqr, q3 + 1.5 * iqr
        baseline["features"][col] = {
            "mean": float(df[col].mean()),
            "variance": float(df[col].var()),
            "q1": float(q1),
            "q3": float(q3),
            "lower_whisker": float(lower),
            "upper_whisker": float(upper),
            "outlier_ratio": float(((df[col] < lower) | (df[col] > upper)).mean()),
        }

    drift_path = artifact_dir / "drift_baseline.json"
    drift_path.write_text(json.dumps(baseline, indent=2))
    print(f"Drift baseline saved → {drift_path}")


def detect_drift(
    new_df: pd.DataFrame,
    baseline_path: Path,
    mean_z_threshold: float = 2.0,
    variance_pct_threshold: float = 0.20,
    prevalence_threshold: float = 0.003,
) -> dict:
    """
    Compare a new production batch against the stored drift baseline.

    Parameters
    ----------
    new_df              : new batch DataFrame (same schema as training data)
    baseline_path       : path to drift_baseline.json
    mean_z_threshold    : z-score threshold for mean drift (default 2.0 σ)
    variance_pct_threshold: fractional variance change threshold (default 20%)
    prevalence_threshold: absolute fraud prevalence drift threshold (default 0.003)

    Returns
    -------
    dict with keys:
        retrain_needed   : bool — True if any drift threshold exceeded
        prevalence_drift : float — change in fraud prevalence
        drifted_features : list[str] — features that exceeded thresholds
        details          : dict — per-feature drift metrics
    """
    baseline = json.loads(baseline_path.read_text())
    num_cols = [c for c in new_df.columns if pd.api.types.is_numeric_dtype(new_df[c]) and c != "is_fraud"]

    drifted: list[str] = []
    details: dict = {}
    eps = 1e-9

    for col in num_cols:
        if col not in baseline["features"]:
            continue
        b = baseline["features"][col]
        new_mean = float(new_df[col].mean())
        new_var = float(new_df[col].var())
        baseline_std = float(np.sqrt(b["variance"]) + eps)

        mean_z = abs(new_mean - b["mean"]) / baseline_std
        var_pct_change = abs(new_var / (b["variance"] + eps) - 1.0)

        mean_drifted = mean_z > mean_z_threshold
        var_drifted = var_pct_change > variance_pct_threshold
        if mean_drifted or var_drifted:
            drifted.append(col)

        details[col] = {
            "mean_z_score": round(mean_z, 4),
            "variance_pct_change": round(var_pct_change, 4),
            "mean_drifted": mean_drifted,
            "variance_drifted": var_drifted,
        }

    prevalence_drift = 0.0
    prevalence_drifted = False
    if "is_fraud" in new_df.columns:
        prevalence_drift = abs(float(new_df["is_fraud"].mean()) - baseline["fraud_prevalence"])
        prevalence_drifted = prevalence_drift > prevalence_threshold

    retrain_needed = bool(drifted) or prevalence_drifted
    return {
        "retrain_needed": retrain_needed,
        "prevalence_drift": round(prevalence_drift, 6),
        "drifted_features": drifted,
        "details": details,
    }

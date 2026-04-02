"""
Feature engineering for fraud detection.

All features are derived from raw transaction columns:
    amount, oldbalanceOrg, newbalanceOrig, oldbalanceDest, newbalanceDest, type

Engineered features
-------------------
amount_log                  : log1p transform — compresses heavy-tail distribution
balance_delta_org           : how much sender balance decreased
balance_delta_dest          : how much receiver balance increased
amount_to_org_balance_ratio : transaction size relative to sender's balance
amount_to_dest_balance_ratio: transaction size relative to receiver's balance
is_large_transaction        : binary flag — top-5% transaction by amount
mean_shift_score            : composite z-score across amount, org-delta, dest-delta
variance_bucket             : quartile-based log-amount bucket label
outlier_flag_*              : IQR-based outlier flags for key columns
"""
from __future__ import annotations

import numpy as np
import pandas as pd


def add_base_features(df: pd.DataFrame) -> pd.DataFrame:
    """
    Add engineered features to a raw transaction DataFrame in-place (on a copy).

    Parameters
    ----------
    df : pd.DataFrame
        Raw transaction frame with columns:
        amount, oldbalanceOrg, newbalanceOrig, oldbalanceDest, newbalanceDest, type

    Returns
    -------
    pd.DataFrame
        New DataFrame with all original columns plus engineered features.
    """
    df = df.copy()
    eps = 1e-6

    # --- log transform ---
    df["amount_log"] = np.log1p(df["amount"].clip(lower=0))

    # --- balance deltas ---
    df["balance_delta_org"] = df["oldbalanceOrg"] - df["newbalanceOrig"]
    df["balance_delta_dest"] = df["newbalanceDest"] - df["oldbalanceDest"]

    # --- ratio features ---
    df["amount_to_org_balance_ratio"] = df["amount"] / (df["oldbalanceOrg"].abs() + eps)
    df["amount_to_dest_balance_ratio"] = df["amount"] / (df["oldbalanceDest"].abs() + eps)

    # --- binary large-transaction flag (top 5%) ---
    df["is_large_transaction"] = (df["amount"] > df["amount"].quantile(0.95)).astype(int)

    # --- mean shift score: composite z-score ---
    z_amount = ((df["amount"] - df["amount"].mean()) / (df["amount"].std() + eps)).abs()
    z_org = ((df["balance_delta_org"] - df["balance_delta_org"].mean()) / (df["balance_delta_org"].std() + eps)).abs()
    z_dest = ((df["balance_delta_dest"] - df["balance_delta_dest"].mean()) / (df["balance_delta_dest"].std() + eps)).abs()
    df["mean_shift_score"] = (z_amount + z_org + z_dest) / 3.0

    # --- variance bucket: quartile label on log amount ---
    df["variance_bucket"] = pd.qcut(
        df["amount_log"],
        q=4,
        labels=["vlow", "low", "high", "vhigh"],
        duplicates="drop",
    ).astype(str)

    # --- IQR-based outlier flags ---
    for col in ["amount", "balance_delta_org", "balance_delta_dest"]:
        q1, q3 = df[col].quantile([0.25, 0.75])
        iqr = q3 - q1
        lower, upper = q1 - 1.5 * iqr, q3 + 1.5 * iqr
        df[f"outlier_flag_{col}"] = ((df[col] < lower) | (df[col] > upper)).astype(int)

    # --- clip extreme ratios and scores to [0.1%, 99.9%] ---
    for col in ["amount_to_org_balance_ratio", "amount_to_dest_balance_ratio", "mean_shift_score"]:
        lo, hi = df[col].quantile([0.001, 0.999])
        df[col] = df[col].clip(lower=lo, upper=hi)

    return df

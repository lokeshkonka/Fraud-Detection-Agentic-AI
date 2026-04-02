"""
Model definitions and training pipeline.

Models trained
--------------
lr  — Logistic Regression with class-weight imbalance correction
rf  — Random Forest with class-weight imbalance correction
xgb — XGBoost with scale_pos_weight imbalance correction (if xgboost is installed)

Key hyperparameters (XGBoost champion)
---------------------------------------
n_estimators   = 420   (tuned via PR-AUC on validation set)
max_depth      = 7     (balances expressiveness vs overfitting)
learning_rate  = 0.05  (low LR + high n_estimators → smoother loss surface)
subsample      = 0.9   (row sampling reduces variance)
colsample_bytree = 0.9 (feature sampling reduces correlation between trees)
reg_lambda     = 1.1   (L2 regularisation against overfitting)
min_child_weight = 3   (prevents splits on tiny fraud sub-groups)
gamma          = 0.1   (minimum gain required to make a split)
scale_pos_weight = neg/pos (compensates 1% fraud prevalence)
eval_metric    = aucpr (training monitors PR-AUC directly)

Data synthesis
--------------
When no real dataset is found the pipeline synthesises 250 000 rows at 1% fraud
prevalence using PaySim-inspired gamma/normal distributions.
"""
from __future__ import annotations

import os
from pathlib import Path
from typing import Dict

import joblib
import numpy as np
import pandas as pd
import pandas.api.types as pat
from sklearn.model_selection import train_test_split
from sklearn.pipeline import Pipeline
from sklearn.ensemble import RandomForestClassifier
from sklearn.linear_model import LogisticRegression

try:
    from xgboost import XGBClassifier
    HAS_XGB = True
except Exception:
    HAS_XGB = False

from ml.features.feature_engineering import add_base_features
from ml.eda.analysis import save_eda, build_preprocessor
from ml.evaluation.metrics import eval_and_curves, variant_comparison
from ml.explainability.shap_explainer import shap_and_skew
from ml.drift.drift_monitor import compute_drift_baseline

ROOT = Path(__file__).resolve().parent.parent.parent
DATA_PATH = Path(os.getenv("FRAUD_DATA_PATH", ROOT / "data" / "processed" / "transactions.parquet"))
MIN_ROWS = int(os.getenv("FRAUD_MIN_ROWS", "220000"))
SYNTHETIC_ROWS = int(os.getenv("FRAUD_SYNTHETIC_ROWS", "250000"))
FRAUD_RATIO = float(os.getenv("FRAUD_RATIO", "0.01"))
MODELS_DIR = ROOT / "models"
ARTIFACT_EDA = ROOT / "artifacts" / "eda"
ARTIFACT_MODEL = ROOT / "artifacts" / "model_eval"
ARTIFACT_SHAP = ROOT / "artifacts" / "shap"
ARTIFACT_DRIFT = ROOT / "artifacts" / "drift"

RNG_SEED = 42


def synthesize_transactions(
    n_rows: int = SYNTHETIC_ROWS,
    fraud_ratio: float = FRAUD_RATIO,
    rng_seed: int = RNG_SEED,
) -> pd.DataFrame:
    """
    Synthesise a realistic transaction dataset when no real data is available.

    Distributions are inspired by PaySim (Kaggle synthetic financial dataset):
    - amount       : Gamma(shape=2, scale=200) — right-skewed, heavy tail
    - balances     : Normal (origin μ=5000, dest μ=2000) — realistic account sizes
    - fraud labels : Bernoulli(p=fraud_ratio) — 1% by default (bank-realistic)
    - tx_type      : uniform over PAYMENT / TRANSFER / CASH_OUT / DEBIT

    Parameters
    ----------
    n_rows      : number of transactions to generate
    fraud_ratio : fraction of rows labelled fraud (default 0.01)
    rng_seed    : NumPy random seed for reproducibility

    Returns
    -------
    pd.DataFrame with columns matching the real dataset schema
    """
    rng = np.random.default_rng(rng_seed)
    labels = rng.choice([0, 1], size=n_rows, p=[1 - fraud_ratio, fraud_ratio])
    amount = rng.gamma(shape=2.0, scale=200.0, size=n_rows)
    oldbalanceOrg = rng.normal(loc=5000, scale=1500, size=n_rows)
    newbalanceOrig = oldbalanceOrg - amount * rng.uniform(0.8, 1.0, size=n_rows)
    oldbalanceDest = rng.normal(loc=2000, scale=1000, size=n_rows)
    newbalanceDest = oldbalanceDest + amount * rng.uniform(0.7, 1.0, size=n_rows)
    tx_type = rng.choice(["PAYMENT", "TRANSFER", "CASH_OUT", "DEBIT"], size=n_rows)
    return pd.DataFrame(
        {
            "amount": amount,
            "oldbalanceOrg": oldbalanceOrg,
            "newbalanceOrig": newbalanceOrig,
            "oldbalanceDest": oldbalanceDest,
            "newbalanceDest": newbalanceDest,
            "type": tx_type,
            "is_fraud": labels,
        }
    )


def load_dataset(path: Path = DATA_PATH) -> pd.DataFrame:
    """
    Load dataset from parquet or CSV; synthesise if the file does not exist.

    Augments with synthetic rows if the loaded dataset has fewer than MIN_ROWS rows.
    Supports both 'is_fraud' and 'isFraud' target column names.

    Parameters
    ----------
    path : Path to the dataset file (parquet or CSV)

    Returns
    -------
    pd.DataFrame with column 'is_fraud' as the binary target
    """
    def _normalize_target(df: pd.DataFrame) -> pd.DataFrame:
        if "is_fraud" in df.columns:
            return df
        if "isFraud" in df.columns:
            return df.rename(columns={"isFraud": "is_fraud"})
        raise ValueError("Dataset must have 'is_fraud' or 'isFraud' target column")

    if path.exists():
        df = pd.read_parquet(path) if path.suffix.lower() == ".parquet" else pd.read_csv(path)
        df = _normalize_target(df)
        print(f"Loaded {df.shape[0]:,} rows from {path}")
    else:
        print(f"No data at {path} — synthesising {SYNTHETIC_ROWS:,} rows at {FRAUD_RATIO:.1%} fraud.")
        df = synthesize_transactions()

    if len(df) < MIN_ROWS:
        deficit = MIN_ROWS - len(df)
        print(f"Augmenting with {deficit:,} synthetic rows to reach {MIN_ROWS:,}.")
        extra = synthesize_transactions(n_rows=deficit, rng_seed=RNG_SEED + 1)
        df = pd.concat([df, extra], ignore_index=True).sample(frac=1.0, random_state=RNG_SEED).reset_index(drop=True)

    return df


def train_models(
    X_train: pd.DataFrame,
    y_train: pd.Series,
    preprocessor,
    models_dir: Path = MODELS_DIR,
    save_models: bool = True,
) -> Dict[str, Pipeline]:
    """
    Fit LR, RF, and XGBoost models with imbalance-aware weighting.

    Imbalance handling
    ------------------
    - LR / RF  : class_weight = {0: 1.0, 1: neg/pos}
    - XGBoost  : scale_pos_weight = neg/pos

    Both approaches up-weight the minority class so the loss function penalises
    missing a fraud transaction (positive class) proportionally more than a legit one.

    Parameters
    ----------
    X_train     : training features
    y_train     : binary target (0=legit, 1=fraud)
    preprocessor: fitted or unfitted ColumnTransformer
    models_dir  : directory where joblib model files are saved
    save_models : if True, persist fitted pipelines to disk

    Returns
    -------
    dict mapping model name → fitted sklearn Pipeline
    """
    pos = max(int(y_train.sum()), 1)
    neg = max(len(y_train) - pos, 1)
    pos_weight = neg / pos
    cls_weight = {0: 1.0, 1: float(pos_weight)}

    model_specs: Dict[str, Pipeline] = {
        "lr": Pipeline([
            ("preprocess", preprocessor),
            ("clf", LogisticRegression(max_iter=450, class_weight=cls_weight, C=0.4)),
        ]),
        "rf": Pipeline([
            ("preprocess", preprocessor),
            ("clf", RandomForestClassifier(
                n_estimators=260,
                max_depth=18,
                min_samples_leaf=2,
                n_jobs=-1,
                class_weight=cls_weight,
                random_state=RNG_SEED,
            )),
        ]),
    }
    if HAS_XGB:
        model_specs["xgb"] = Pipeline([
            ("preprocess", preprocessor),
            ("clf", XGBClassifier(
                max_depth=7,
                n_estimators=420,
                learning_rate=0.05,
                subsample=0.9,
                colsample_bytree=0.9,
                reg_lambda=1.1,
                min_child_weight=3,
                gamma=0.1,
                scale_pos_weight=float(pos_weight),
                max_delta_step=1,
                tree_method="hist",
                objective="binary:logistic",
                eval_metric="aucpr",
                random_state=RNG_SEED,
            )),
        ])

    fitted: Dict[str, Pipeline] = {}
    models_dir.mkdir(parents=True, exist_ok=True)
    for name, model in model_specs.items():
        print(f"Training {name}...")
        model.fit(X_train, y_train)
        fitted[name] = model
        if save_models:
            joblib.dump(model, models_dir / f"{name}.joblib")

    if save_models:
        print(f"Models saved → {models_dir}")
    return fitted


def run() -> None:
    """
    Full end-to-end training run:
    1. Load / synthesise dataset
    2. Feature engineering
    3. EDA artifacts
    4. Train LR / RF / XGB
    5. Evaluate and plot curves
    6. Variant comparison
    7. SHAP + skew stats
    8. Drift baseline
    """
    for p in [ARTIFACT_EDA, ARTIFACT_MODEL, ARTIFACT_SHAP, ARTIFACT_DRIFT, MODELS_DIR]:
        p.mkdir(parents=True, exist_ok=True)

    df_raw = load_dataset(DATA_PATH)
    print(f"Rows: {len(df_raw):,} | fraud_prevalence={df_raw['is_fraud'].mean():.4f}")

    df = add_base_features(df_raw)
    save_eda(df, ARTIFACT_EDA)

    cat_cols = [c for c in df.columns if pat.is_object_dtype(df[c]) or pat.is_string_dtype(df[c])]
    num_cols = [c for c in df.columns if c not in cat_cols + ["is_fraud"]]
    preprocessor = build_preprocessor(cat_cols, num_cols)

    X = df.drop(columns=["is_fraud"])
    y = df["is_fraud"]
    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, random_state=RNG_SEED, stratify=y
    )

    models = train_models(X_train, y_train, preprocessor)
    metrics_df = eval_and_curves(models, X_test, y_test, ARTIFACT_MODEL)
    metrics_path = ARTIFACT_MODEL / "model_eval_summary.csv"
    metrics_df.drop(columns=["probs", "pr_curve", "roc_curve"], errors="ignore").to_csv(metrics_path, index=False)
    print(f"Metrics saved → {metrics_path}")

    variant_comparison(df, ARTIFACT_MODEL)
    shap_and_skew(models, X_test, num_cols, ARTIFACT_SHAP)
    compute_drift_baseline(df, ARTIFACT_DRIFT)
    print("Pipeline complete.")


if __name__ == "__main__":
    run()

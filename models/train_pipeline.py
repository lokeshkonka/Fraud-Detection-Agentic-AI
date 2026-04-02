"""
Unified CPU-only training pipeline merging notebooks 01-05.
- EDA: stats, histograms, boxplots -> artifacts/eda
- Models: LR/RF/optional XGB with cumulative curves -> artifacts/model_eval
- Feature variants + thresholds.json
- SHAP (if installed) + skew stats -> artifacts/shap
- Drift baseline export -> artifacts/drift
- Models saved under models/
Configure via env vars:
- FRAUD_DATA_PATH: input dataset path (default data/processed/transactions.parquet)
- FRAUD_MIN_ROWS: minimum rows to train on (default 220000)
- FRAUD_SYNTHETIC_ROWS: rows for synthesized data when no file is present (default 250000)
- FRAUD_RATIO: fraud prevalence used for synthesis (default 0.01)
"""
from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Dict, Tuple

import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
import pandas.api.types as pat
import seaborn as sns
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import RandomForestClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import auc, precision_recall_curve, roc_curve
from sklearn.model_selection import train_test_split
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler

try:
    from xgboost import XGBClassifier

    HAS_XGB = True
except Exception:
    HAS_XGB = False

try:
    import shap

    HAS_SHAP = True
except Exception:
    HAS_SHAP = False

import joblib

plt.style.use("dark_background")
sns.set_theme(style="darkgrid")

ROOT = Path(__file__).resolve().parent.parent
DATA_PATH = Path(os.getenv("FRAUD_DATA_PATH", ROOT / "data" / "processed" / "transactions.parquet"))
MIN_ROWS = int(os.getenv("FRAUD_MIN_ROWS", "220000"))
SYNTHETIC_ROWS = int(os.getenv("FRAUD_SYNTHETIC_ROWS", "250000"))
FRAUD_RATIO = float(os.getenv("FRAUD_RATIO", "0.01"))
ARTIFACT_EDA = ROOT / "artifacts" / "eda"
ARTIFACT_MODEL = ROOT / "artifacts" / "model_eval"
ARTIFACT_SHAP = ROOT / "artifacts" / "shap"
ARTIFACT_DRIFT = ROOT / "artifacts" / "drift"
MODELS_DIR = ROOT / "models"
for p in [ARTIFACT_EDA, ARTIFACT_MODEL, ARTIFACT_SHAP, ARTIFACT_DRIFT, MODELS_DIR]:
    p.mkdir(parents=True, exist_ok=True)

RNG_SEED = 42


def synthesize_transactions(n_rows: int = SYNTHETIC_ROWS, fraud_ratio: float = FRAUD_RATIO, rng_seed: int = RNG_SEED) -> pd.DataFrame:
    rng = np.random.default_rng(rng_seed)
    labels = rng.choice([0, 1], size=n_rows, p=[1 - fraud_ratio, fraud_ratio]).astype(int)
    is_fraud = labels == 1
    step = rng.integers(1, 745, size=n_rows)

    tx_type = np.empty(n_rows, dtype=object)
    tx_type[~is_fraud] = rng.choice(
        ["PAYMENT", "TRANSFER", "CASH_OUT", "DEBIT"],
        size=(~is_fraud).sum(),
        p=[0.56, 0.19, 0.16, 0.09],
    )
    tx_type[is_fraud] = rng.choice(
        ["PAYMENT", "TRANSFER", "CASH_OUT", "DEBIT"],
        size=is_fraud.sum(),
        p=[0.02, 0.57, 0.38, 0.03],
    )

    amount = np.empty(n_rows)
    amount[~is_fraud] = rng.gamma(shape=2.1, scale=180.0, size=(~is_fraud).sum())
    amount[is_fraud] = rng.gamma(shape=5.4, scale=720.0, size=is_fraud.sum()) + rng.uniform(350, 1100, size=is_fraud.sum())
    amount = np.clip(amount, a_min=1.0, a_max=None)

    oldbalanceOrg = np.empty(n_rows)
    oldbalanceOrg[~is_fraud] = rng.normal(loc=6200, scale=1700, size=(~is_fraud).sum())
    oldbalanceOrg[is_fraud] = amount[is_fraud] * rng.uniform(0.85, 1.35, size=is_fraud.sum()) + rng.normal(280, 180, size=is_fraud.sum())
    oldbalanceOrg = np.clip(oldbalanceOrg, a_min=80.0, a_max=None)

    newbalanceOrig = np.empty(n_rows)
    newbalanceOrig[~is_fraud] = oldbalanceOrg[~is_fraud] - amount[~is_fraud] * rng.uniform(0.70, 0.98, size=(~is_fraud).sum())
    fraud_post = oldbalanceOrg[is_fraud] - amount[is_fraud] * rng.uniform(0.95, 1.08, size=is_fraud.sum())
    drained = rng.random(is_fraud.sum()) < 0.72
    fraud_post[drained] = rng.uniform(0.0, 15.0, size=drained.sum())
    newbalanceOrig[is_fraud] = fraud_post
    newbalanceOrig = np.clip(newbalanceOrig, a_min=0.0, a_max=None)

    oldbalanceDest = np.empty(n_rows)
    oldbalanceDest[~is_fraud] = rng.normal(loc=2400, scale=1100, size=(~is_fraud).sum())
    oldbalanceDest[is_fraud] = rng.normal(loc=700, scale=430, size=is_fraud.sum())
    oldbalanceDest = np.clip(oldbalanceDest, a_min=0.0, a_max=None)

    newbalanceDest = np.empty(n_rows)
    newbalanceDest[~is_fraud] = oldbalanceDest[~is_fraud] + amount[~is_fraud] * rng.uniform(0.65, 0.95, size=(~is_fraud).sum())
    newbalanceDest[is_fraud] = oldbalanceDest[is_fraud] + amount[is_fraud] * rng.uniform(0.92, 1.16, size=is_fraud.sum())
    newbalanceDest = np.clip(newbalanceDest, a_min=0.0, a_max=None)

    return pd.DataFrame(
        {
            "step": step,
            "amount": amount,
            "oldbalanceOrg": oldbalanceOrg,
            "newbalanceOrig": newbalanceOrig,
            "oldbalanceDest": oldbalanceDest,
            "newbalanceDest": newbalanceDest,
            "type": tx_type,
            "is_fraud": labels,
        }
    )


def load_dataset(path: Path) -> pd.DataFrame:
    def normalize_target(df: pd.DataFrame) -> pd.DataFrame:
        if "is_fraud" in df.columns:
            return df
        if "isFraud" in df.columns:
            return df.rename(columns={"isFraud": "is_fraud"})
        raise ValueError("Dataset must contain either 'is_fraud' or 'isFraud' target column")

    if path.exists():
        if path.suffix.lower() == ".parquet":
            df = pd.read_parquet(path)
        else:
            df = pd.read_csv(path)
        df = normalize_target(df)
        print(f"Loaded dataset from {path} with shape {df.shape}")
    else:
        print(f"Data path not found: {path}. Synthesizing dataset with {SYNTHETIC_ROWS} rows (~{FRAUD_RATIO:.2%} fraud).")
        df = synthesize_transactions(n_rows=SYNTHETIC_ROWS, fraud_ratio=FRAUD_RATIO)

    if len(df) < MIN_ROWS:
        deficit = MIN_ROWS - len(df)
        print(f"Dataset has {len(df)} rows; augmenting with {deficit} synthetic rows to reach {MIN_ROWS}.")
        extra = synthesize_transactions(n_rows=deficit, fraud_ratio=FRAUD_RATIO, rng_seed=RNG_SEED + 1)
        df = pd.concat([df, extra], ignore_index=True)
        df = df.sample(frac=1.0, random_state=RNG_SEED).reset_index(drop=True)

    return df


def add_base_features(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    df["amount_log"] = np.log1p(df["amount"].clip(lower=0))
    df["balance_delta_org"] = df["oldbalanceOrg"] - df["newbalanceOrig"]
    df["balance_delta_dest"] = df["newbalanceDest"] - df["oldbalanceDest"]
    eps = 1e-6
    df["amount_to_org_balance_ratio"] = df["amount"] / (df["oldbalanceOrg"].abs() + eps)
    df["amount_to_dest_balance_ratio"] = df["amount"] / (df["oldbalanceDest"].abs() + eps)
    df["is_large_transaction"] = (df["amount"] > df["amount"].quantile(0.95)).astype(int)

    z_amount = ((df["amount"] - df["amount"].mean()) / (df["amount"].std() + eps)).abs()
    z_org = ((df["balance_delta_org"] - df["balance_delta_org"].mean()) / (df["balance_delta_org"].std() + eps)).abs()
    z_dest = ((df["balance_delta_dest"] - df["balance_delta_dest"].mean()) / (df["balance_delta_dest"].std() + eps)).abs()
    df["mean_shift_score"] = (z_amount + z_org + z_dest) / 3.0
    df["variance_bucket"] = pd.qcut(df["amount_log"], q=4, labels=["vlow", "low", "high", "vhigh"], duplicates="drop").astype(str)

    for col in ["amount", "balance_delta_org", "balance_delta_dest"]:
        q1, q3 = df[col].quantile([0.25, 0.75])
        iqr = q3 - q1
        lower, upper = q1 - 1.5 * iqr, q3 + 1.5 * iqr
        df[f"outlier_flag_{col}"] = ((df[col] < lower) | (df[col] > upper)).astype(int)

    clip_cols = [
        "amount_to_org_balance_ratio",
        "amount_to_dest_balance_ratio",
        "mean_shift_score",
    ]
    for col in clip_cols:
        lo, hi = df[col].quantile([0.001, 0.999])
        df[col] = df[col].clip(lower=lo, upper=hi)

    return df


def save_eda(df: pd.DataFrame) -> None:
    numeric_cols = [c for c in df.columns if pd.api.types.is_numeric_dtype(df[c]) and c != "is_fraud"]
    summary = df[numeric_cols].agg(["mean", "var"]).T.rename(columns={"var": "variance"})
    summary_path = ARTIFACT_EDA / "feature_stats.csv"
    summary.to_csv(summary_path)
    print(f"Saved feature stats to {summary_path}")

    num_for_hist = numeric_cols[:8]
    fig, axes = plt.subplots(2, max(1, int(np.ceil(len(num_for_hist) / 2))), figsize=(16, 8))
    axes = axes.flatten()
    for ax, col in zip(axes, num_for_hist):
        sns.histplot(df[col], bins=40, kde=False, ax=ax)
        ax.set_title(f"Histogram: {col}")
    plt.tight_layout()
    hist_path = ARTIFACT_EDA / "dataset_analysis_graphs.png"
    fig.savefig(hist_path)
    plt.close(fig)
    print(f"Saved histograms to {hist_path}")

    fig, axes = plt.subplots(2, max(1, int(np.ceil(len(num_for_hist) / 2))), figsize=(16, 8))
    axes = axes.flatten()
    for ax, col in zip(axes, num_for_hist):
        sns.boxplot(x=df[col], ax=ax, orient="h")
        ax.set_title(f"Boxplot: {col}")
    plt.tight_layout()
    box_path = ARTIFACT_EDA / "dataset_boxplots.png"
    fig.savefig(box_path)
    plt.close(fig)
    print(f"Saved boxplots to {box_path}")


def build_preprocessor(cat_cols, num_cols):
    numeric_transformer = Pipeline([("scaler", StandardScaler())])
    categorical_transformer = Pipeline([("encoder", OneHotEncoder(handle_unknown="ignore"))])
    return ColumnTransformer(
        transformers=[
            ("num", numeric_transformer, num_cols),
            ("cat", categorical_transformer, cat_cols),
        ]
    )


def train_models(X_train, y_train, preprocessor, save_models: bool = True):
    pos = max(int(y_train.sum()), 1)
    neg = max(len(y_train) - pos, 1)
    pos_weight = neg / pos
    cls_weight = {0: 1.0, 1: float(pos_weight)}

    models = {}
    models["lr"] = Pipeline(
        steps=[("preprocess", preprocessor), ("clf", LogisticRegression(max_iter=450, class_weight=cls_weight, C=0.4))]
    )
    models["rf"] = Pipeline(
        steps=[
            ("preprocess", preprocessor),
            (
                "clf",
                RandomForestClassifier(
                    n_estimators=260,
                    max_depth=18,
                    min_samples_leaf=2,
                    n_jobs=-1,
                    class_weight=cls_weight,
                    random_state=RNG_SEED,
                ),
            ),
        ]
    )
    if HAS_XGB:
        models["xgb"] = Pipeline(
            steps=[
                ("preprocess", preprocessor),
                (
                    "clf",
                    XGBClassifier(
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
                    ),
                ),
            ]
        )
    fitted = {}
    for name, model in models.items():
        print(f"Training {name}...")
        model.fit(X_train, y_train)
        fitted[name] = model
        if save_models:
            joblib.dump(model, MODELS_DIR / f"{name}.joblib")
    if save_models:
        print(f"Saved models to {MODELS_DIR}")
    return fitted


def cumulative_metrics(y_true: np.ndarray, probs: np.ndarray) -> pd.DataFrame:
    order = np.argsort(-probs)
    y_sorted = y_true[order]
    probs_sorted = probs[order]
    cum_tp = np.cumsum(y_sorted)
    cum_fp = np.cumsum(1 - y_sorted)
    idx = np.arange(1, len(y_sorted) + 1)
    precision = cum_tp / idx
    recall = cum_tp / (y_sorted.sum() + 1e-9)
    fpr = cum_fp / (cum_fp[-1] + 1e-9)
    return pd.DataFrame({"k": idx, "proba": probs_sorted, "precision": precision, "recall": recall, "fpr": fpr})


def eval_and_curves(models: Dict[str, Pipeline], X_test, y_test) -> pd.DataFrame:
    def topk_metrics(y_true: np.ndarray, probs: np.ndarray, frac: float) -> tuple[float, float]:
        k = max(1, int(len(y_true) * frac))
        order = np.argsort(-probs)
        y_top = y_true[order][:k]
        precision = float(y_top.mean())
        recall = float(y_top.sum() / max(y_true.sum(), 1))
        return precision, recall

    rows = []
    fig_pr, ax_pr = plt.subplots(figsize=(8, 6))
    fig_roc, ax_roc = plt.subplots(figsize=(8, 6))

    for name, model in models.items():
        probs = model.predict_proba(X_test)[:, 1]
        cm_df = cumulative_metrics(y_test.to_numpy(), probs)
        fig, ax = plt.subplots(figsize=(8, 6))
        ax.plot(cm_df["k"], cm_df["precision"], label="precision")
        ax.plot(cm_df["k"], cm_df["recall"], label="recall")
        ax.plot(cm_df["k"], cm_df["fpr"], label="false positive rate")
        ax.set_xlabel("Transactions (sorted by risk)")
        ax.set_ylabel("Metric")
        ax.set_title(f"Cumulative metrics - {name}")
        ax.legend()
        path = ARTIFACT_MODEL / f"{name}_accuracy_curve.png"
        fig.savefig(path)
        plt.close(fig)

        pr, rc, _ = precision_recall_curve(y_test, probs)
        fpr_curve, tpr_curve, _ = roc_curve(y_test, probs)
        pr_auc = auc(rc, pr)
        roc_auc = auc(fpr_curve, tpr_curve)
        p1, r1 = topk_metrics(y_test.to_numpy(), probs, 0.01)
        p5, r5 = topk_metrics(y_test.to_numpy(), probs, 0.05)
        p10, r10 = topk_metrics(y_test.to_numpy(), probs, 0.10)
        rows.append(
            {
                "model": name,
                "pr_auc": pr_auc,
                "roc_auc": roc_auc,
                "final_precision": cm_df["precision"].iloc[-1],
                "final_recall": cm_df["recall"].iloc[-1],
                "precision_top1pct": p1,
                "recall_top1pct": r1,
                "precision_top5pct": p5,
                "recall_top5pct": r5,
                "precision_top10pct": p10,
                "recall_top10pct": r10,
                "probs": probs,
                "pr_curve": (pr, rc),
                "roc_curve": (fpr_curve, tpr_curve),
            }
        )

        ax_pr.plot(rc, pr, label=f"{name} (AUC={pr_auc:.3f})")
        ax_roc.plot(fpr_curve, tpr_curve, label=f"{name} (AUC={roc_auc:.3f})")

    ax_pr.set_title("Precision-Recall")
    ax_pr.set_xlabel("Recall")
    ax_pr.set_ylabel("Precision")
    ax_pr.legend()
    pr_path = ARTIFACT_MODEL / "model_pr_curves.png"
    fig_pr.savefig(pr_path)
    plt.close(fig_pr)

    ax_roc.set_title("ROC")
    ax_roc.set_xlabel("FPR")
    ax_roc.set_ylabel("TPR")
    ax_roc.legend()
    roc_path = ARTIFACT_MODEL / "model_roc_curves.png"
    fig_roc.savefig(roc_path)
    plt.close(fig_roc)

    print(f"Saved PR/ROC curves to {pr_path}, {roc_path}")
    return pd.DataFrame(rows)


def best_thresholds(y_true: np.ndarray, probs: np.ndarray) -> Tuple[float, float, float]:
    pr, rc, th_pr = precision_recall_curve(y_true, probs)
    fpr, tpr, th_roc = roc_curve(y_true, probs)

    if len(th_pr) > 0:
        f1s = 2 * (pr[1:] * rc[1:]) / (pr[1:] + rc[1:] + 1e-9)
        best_f1_idx = int(np.argmax(f1s))
        best_pr_threshold = float(th_pr[best_f1_idx])
        best_f1 = float(f1s[best_f1_idx])
    else:
        best_pr_threshold, best_f1 = 0.5, 0.0

    youden = tpr - fpr
    best_roc_idx = int(np.argmax(youden))
    best_roc_threshold = th_roc[best_roc_idx]
    return best_pr_threshold, best_f1, best_roc_threshold


def variant_comparison(df_base: pd.DataFrame) -> None:
    def clip_outliers(df: pd.DataFrame, cols: list) -> pd.DataFrame:
        df = df.copy()
        for col in cols:
            q1, q3 = df[col].quantile([0.25, 0.75])
            iqr = q3 - q1
            lower, upper = q1 - 1.5 * iqr, q3 + 1.5 * iqr
            df[col] = df[col].clip(lower=lower, upper=upper)
        return df

    variants = {
        "A_base": df_base,
        "B_clipped": clip_outliers(df_base, ["amount", "balance_delta_org", "balance_delta_dest"]),
        "C_amount_log_only": df_base.assign(amount=df_base["amount_log"]).drop(columns=["amount_log"], errors="ignore"),
        "D_balance_delta_focus": df_base[
            ["balance_delta_org", "balance_delta_dest", "amount", "oldbalanceOrg", "newbalanceOrig", "oldbalanceDest", "newbalanceDest", "type", "is_fraud"]
        ],
    }

    summary_rows = []
    curve_cache = {}
    for vname, dfv in variants.items():
        X = dfv.drop(columns=["is_fraud"])
        y = dfv["is_fraud"]
        X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=RNG_SEED, stratify=y)
        cat_cols = [c for c in X_train.columns if pat.is_object_dtype(X_train[c]) or pat.is_string_dtype(X_train[c])]
        num_cols = [c for c in X_train.columns if c not in cat_cols]
        preprocessor = build_preprocessor(cat_cols, num_cols)
        models = train_models(X_train, y_train, preprocessor, save_models=False)
        for mname, model in models.items():
            probs = model.predict_proba(X_test)[:, 1]
            pr_auc, roc_auc = None, None
            pr, rc, _ = precision_recall_curve(y_test, probs)
            fpr_curve, tpr_curve, _ = roc_curve(y_test, probs)
            pr_auc = auc(rc, pr)
            roc_auc = auc(fpr_curve, tpr_curve)
            curve_cache[(vname, mname)] = (rc, pr, fpr_curve, tpr_curve)
            best_pr_th, best_f1, best_roc_th = best_thresholds(y_test.to_numpy(), probs)
            summary_rows.append(
                {
                    "variant": vname,
                    "model": mname,
                    "pr_auc": pr_auc,
                    "roc_auc": roc_auc,
                    "precision@0.5": ((probs >= 0.5) & (y_test == 1)).sum() / max(((probs >= 0.5)).sum(), 1),
                    "recall@0.5": ((probs >= 0.5) & (y_test == 1)).sum() / max((y_test == 1).sum(), 1),
                    "best_pr_threshold": best_pr_th,
                    "best_f1": best_f1,
                    "best_roc_threshold": best_roc_th,
                }
            )

    summary_df = pd.DataFrame(summary_rows)
    summary_path = ARTIFACT_MODEL / "model_variant_comparison.csv"
    summary_df.to_csv(summary_path, index=False)
    print(f"Saved variant comparison to {summary_path}")

    top3 = summary_df.sort_values(by="pr_auc", ascending=False).head(3)
    fig_pr, ax_pr = plt.subplots(figsize=(8, 6))
    fig_roc, ax_roc = plt.subplots(figsize=(8, 6))
    for _, row in top3.iterrows():
        vname, mname = row["variant"], row["model"]
        rc, pr, fpr_curve, tpr_curve = curve_cache[(vname, mname)]
        ax_pr.plot(rc, pr, label=f"{vname}-{mname} (AUC={row['pr_auc']:.3f})")
        ax_roc.plot(fpr_curve, tpr_curve, label=f"{vname}-{mname} (AUC={row['roc_auc']:.3f})")

    ax_pr.set_xlabel("Recall")
    ax_pr.set_ylabel("Precision")
    ax_pr.set_title("Top3 Precision-Recall")
    ax_pr.legend()
    pr_path = ARTIFACT_MODEL / "top3_pr_curves.png"
    fig_pr.savefig(pr_path)
    plt.close(fig_pr)

    ax_roc.set_xlabel("FPR")
    ax_roc.set_ylabel("TPR")
    ax_roc.set_title("Top3 ROC")
    ax_roc.legend()
    roc_path = ARTIFACT_MODEL / "top3_roc_curves.png"
    fig_roc.savefig(roc_path)
    plt.close(fig_roc)
    print(f"Saved top3 PR/ROC curves to {pr_path}, {roc_path}")

    thresholds_json = {
        f"{r['variant']}_{r['model']}": {
            "best_pr_threshold": float(r["best_pr_threshold"]),
            "best_roc_threshold": float(r["best_roc_threshold"]),
            "pr_auc": float(r["pr_auc"]),
            "roc_auc": float(r["roc_auc"]),
        }
        for _, r in summary_df.iterrows()
    }
    th_path = ARTIFACT_MODEL / "thresholds.json"
    th_path.write_text(json.dumps(thresholds_json, indent=2))
    print(f"Saved thresholds to {th_path}")


def shap_and_skew(models: Dict[str, Pipeline], X_test: pd.DataFrame, num_cols) -> None:
    def _to_dense(matrix):
        return matrix.toarray() if hasattr(matrix, "toarray") else matrix

    def _select_shap_matrix(shap_values_obj, feature_count: int) -> np.ndarray:
        # SHAP can return list, ndarray, or Explanation with values in different axis orders.
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
            raise ValueError(
                f"Cannot locate feature axis in SHAP output shape {arr.shape} for feature_count={feature_count}"
            )
        feature_axis = feature_axes[0]

        class_axes = [i for i, size in enumerate(arr.shape) if i != feature_axis and size in (1, 2)]
        if class_axes:
            class_axis = class_axes[0]
        else:
            class_axis = [i for i in range(3) if i != feature_axis][0]

        class_index = 1 if arr.shape[class_axis] > 1 else 0
        arr2d = np.take(arr, class_index, axis=class_axis)

        feature_axis_after_take = feature_axis - 1 if class_axis < feature_axis else feature_axis
        if feature_axis_after_take == 0:
            return arr2d.T
        return arr2d

    stats = X_test[num_cols].agg(["mean", "var"]).T
    stats["iqr"] = X_test[num_cols].quantile(0.75) - X_test[num_cols].quantile(0.25)
    stats_path = ARTIFACT_SHAP / "skew_stats.csv"
    stats.to_csv(stats_path)
    print(f"Saved skew stats to {stats_path}")

    if not HAS_SHAP:
        readme = ARTIFACT_SHAP / "README.txt"
        readme.write_text("Install shap to compute SHAP values: pip install shap\n")
        print("shap not installed; wrote reminder")
        return

    sample_size = min(5000, len(X_test))
    X_sample = X_test.sample(sample_size, random_state=RNG_SEED)

    if "log_reg" in models:
        lr_pre = models["log_reg"].named_steps.get("preprocess") or models["lr"].named_steps["preprocess"]
    else:
        lr_pre = models.get("lr", list(models.values())[0]).named_steps["preprocess"]
    X_sample_enc_lr = _to_dense(lr_pre.transform(X_sample))
    lr_clf = models.get("log_reg") or models.get("lr")
    try:
        explainer_lr = shap.LinearExplainer(lr_clf.named_steps["clf"], X_sample_enc_lr)
        shap_values_lr = explainer_lr.shap_values(X_sample_enc_lr)
        shap_values_lr_matrix = _select_shap_matrix(shap_values_lr, X_sample_enc_lr.shape[1])
        shap.summary_plot(shap_values_lr_matrix, X_sample_enc_lr, show=False)
        lr_path = ARTIFACT_SHAP / "shap_log_reg_summary.png"
        plt.tight_layout()
        plt.savefig(lr_path)
        plt.close()
        print(f"Saved LR SHAP summary to {lr_path}")
    except Exception as exc:
        plt.close("all")
        print(f"Skipping LR SHAP summary due to error: {exc}")

    if "rf" in models:
        rf_pre = models["rf"].named_steps["preprocess"]
        X_sample_enc_rf = _to_dense(rf_pre.transform(X_sample))
        rf_clf = models["rf"].named_steps["clf"]
        try:
            background = X_sample_enc_rf[: min(200, len(X_sample_enc_rf))]
            explainer_rf = shap.TreeExplainer(rf_clf, data=background, feature_perturbation="interventional")
            shap_values_rf = explainer_rf.shap_values(X_sample_enc_rf)
            shap_values_rf_matrix = _select_shap_matrix(shap_values_rf, X_sample_enc_rf.shape[1])
            shap.summary_plot(shap_values_rf_matrix, X_sample_enc_rf, show=False)
            rf_path = ARTIFACT_SHAP / "shap_rf_summary.png"
            plt.tight_layout()
            plt.savefig(rf_path)
            plt.close()
            print(f"Saved RF SHAP summary to {rf_path}")
        except Exception as exc:
            plt.close("all")
            print(f"Skipping RF SHAP summary due to error: {exc}")


def drift_baseline(df: pd.DataFrame) -> None:
    num_cols = [c for c in df.columns if pd.api.types.is_numeric_dtype(df[c]) and c != "is_fraud"]
    baseline = {}
    baseline["fraud_prevalence"] = float(df["is_fraud"].mean())
    baseline["features"] = {}
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
    drift_path = ARTIFACT_DRIFT / "drift_baseline.json"
    drift_path.write_text(json.dumps(baseline, indent=2))
    print(f"Saved drift baseline to {drift_path}")


def main():
    df_raw = load_dataset(DATA_PATH)
    print(f"Training rows: {len(df_raw)} | fraud_prevalence={df_raw['is_fraud'].mean():.4f}")
    df = add_base_features(df_raw)
    save_eda(df)

    cat_cols = [c for c in df.columns if pat.is_object_dtype(df[c]) or pat.is_string_dtype(df[c])]
    num_cols = [c for c in df.columns if c not in cat_cols + ["is_fraud"]]
    preprocessor = build_preprocessor(cat_cols, num_cols)

    X = df.drop(columns=["is_fraud"])
    y = df["is_fraud"]
    X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=RNG_SEED, stratify=y)

    models = train_models(X_train, y_train, preprocessor)
    metrics_df = eval_and_curves(models, X_test, y_test)
    metrics_path = ARTIFACT_MODEL / "model_eval_summary.csv"
    metrics_df.drop(columns=["probs", "pr_curve", "roc_curve"]).to_csv(metrics_path, index=False)
    print(f"Saved metrics summary to {metrics_path}")

    variant_comparison(df)
    shap_and_skew(models, X_test, num_cols)
    drift_baseline(df)
    print("Pipeline complete.")


if __name__ == "__main__":
    main()

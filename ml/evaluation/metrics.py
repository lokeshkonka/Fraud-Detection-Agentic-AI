"""
Model evaluation: precision-recall, ROC, cumulative accuracy curves,
top-k bucket metrics, threshold optimisation, and variant comparison.

Key metrics
-----------
PR-AUC (Precision-Recall AUC)
    Preferred over ROC-AUC for imbalanced datasets. ROC-AUC is misleadingly
    optimistic when negatives heavily outnumber positives (99:1 ratio). PR-AUC
    directly measures how well the model ranks true positives at the top.

precision@top-k%
    Fraction of fraud cases in the top-k% of transactions ordered by fraud score.
    Bank operations teams review high-risk queues; precision@1% tells how many
    of those reviews are genuine fraud.

recall@top-k%
    What fraction of all fraud is captured in the top-k% queue.

Threshold optimisation
    Best F1 threshold: maximises F1-score on the PR curve (balances precision
    and recall — appropriate for fraud where both missing fraud and false blocks
    are costly).
    Best Youden threshold: maximises (TPR - FPR) on the ROC curve.

Variant comparison
------------------
Four feature variants (A–D) are evaluated:
    A_base              : all engineered features
    B_clipped           : IQR-clipped raw features
    C_amount_log_only   : replace amount with log-transformed amount
    D_balance_delta_focus : keep only balance-delta and raw amount columns
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Dict, Tuple

import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
import pandas.api.types as pat
from sklearn.metrics import auc, precision_recall_curve, roc_curve
from sklearn.model_selection import train_test_split
from sklearn.pipeline import Pipeline

plt.style.use("dark_background")

RNG_SEED = 42


def cumulative_metrics(y_true: np.ndarray, probs: np.ndarray) -> pd.DataFrame:
    """
    Compute cumulative precision, recall, and false-positive-rate as transactions
    are reviewed in descending order of predicted fraud probability.

    Parameters
    ----------
    y_true : ground-truth binary labels
    probs  : predicted fraud probabilities

    Returns
    -------
    pd.DataFrame with columns: k, proba, precision, recall, fpr
    """
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


def best_thresholds(y_true: np.ndarray, probs: np.ndarray) -> Tuple[float, float, float]:
    """
    Find optimal decision thresholds using two strategies.

    1. F1-maximising threshold (PR curve) — best balance of precision and recall
    2. Youden's J threshold (ROC curve) — maximises TPR - FPR

    Parameters
    ----------
    y_true : ground-truth labels
    probs  : predicted fraud probabilities

    Returns
    -------
    (best_pr_threshold, best_f1, best_roc_threshold)
    """
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
    best_roc_threshold = float(th_roc[int(np.argmax(youden))])
    return best_pr_threshold, best_f1, best_roc_threshold


def eval_and_curves(
    models: Dict[str, Pipeline],
    X_test: pd.DataFrame,
    y_test: pd.Series,
    artifact_dir: Path,
) -> pd.DataFrame:
    """
    Evaluate all trained models and produce per-model and combined plots.

    Saves
    -----
    artifacts/model_eval/{model}_accuracy_curve.png  — cumulative precision/recall/fpr
    artifacts/model_eval/model_pr_curves.png          — combined PR curves
    artifacts/model_eval/model_roc_curves.png         — combined ROC curves

    Parameters
    ----------
    models      : dict of model_name → fitted Pipeline
    X_test      : test features
    y_test      : test labels
    artifact_dir: output directory

    Returns
    -------
    pd.DataFrame with per-model evaluation metrics
    """
    artifact_dir.mkdir(parents=True, exist_ok=True)

    def _topk(y_true: np.ndarray, probs: np.ndarray, frac: float) -> Tuple[float, float]:
        k = max(1, int(len(y_true) * frac))
        y_top = y_true[np.argsort(-probs)][:k]
        return float(y_top.mean()), float(y_top.sum() / max(y_true.sum(), 1))

    rows = []
    fig_pr, ax_pr = plt.subplots(figsize=(8, 6))
    fig_roc, ax_roc = plt.subplots(figsize=(8, 6))

    for name, model in models.items():
        probs = model.predict_proba(X_test)[:, 1]
        y_np = y_test.to_numpy()

        cm_df = cumulative_metrics(y_np, probs)
        fig, ax = plt.subplots(figsize=(8, 6))
        ax.plot(cm_df["k"], cm_df["precision"], label="precision")
        ax.plot(cm_df["k"], cm_df["recall"], label="recall")
        ax.plot(cm_df["k"], cm_df["fpr"], label="false positive rate")
        ax.set_xlabel("Transactions (sorted by risk score)")
        ax.set_ylabel("Metric")
        ax.set_title(f"Cumulative metrics — {name}")
        ax.legend()
        fig.savefig(artifact_dir / f"{name}_accuracy_curve.png")
        plt.close(fig)

        pr, rc, _ = precision_recall_curve(y_np, probs)
        fpr_curve, tpr_curve, _ = roc_curve(y_np, probs)
        pr_auc = auc(rc, pr)
        roc_auc_val = auc(fpr_curve, tpr_curve)

        p1, r1 = _topk(y_np, probs, 0.01)
        p5, r5 = _topk(y_np, probs, 0.05)
        p10, r10 = _topk(y_np, probs, 0.10)

        rows.append({
            "model": name,
            "pr_auc": pr_auc,
            "roc_auc": roc_auc_val,
            "final_precision": float(cm_df["precision"].iloc[-1]),
            "final_recall": float(cm_df["recall"].iloc[-1]),
            "precision_top1pct": p1,
            "recall_top1pct": r1,
            "precision_top5pct": p5,
            "recall_top5pct": r5,
            "precision_top10pct": p10,
            "recall_top10pct": r10,
            "probs": probs,
            "pr_curve": (pr, rc),
            "roc_curve": (fpr_curve, tpr_curve),
        })

        ax_pr.plot(rc, pr, label=f"{name} (AUC={pr_auc:.3f})")
        ax_roc.plot(fpr_curve, tpr_curve, label=f"{name} (AUC={roc_auc_val:.3f})")

    ax_pr.set_title("Precision-Recall curves")
    ax_pr.set_xlabel("Recall")
    ax_pr.set_ylabel("Precision")
    ax_pr.legend()
    fig_pr.savefig(artifact_dir / "model_pr_curves.png")
    plt.close(fig_pr)

    ax_roc.set_title("ROC curves")
    ax_roc.set_xlabel("FPR")
    ax_roc.set_ylabel("TPR")
    ax_roc.legend()
    fig_roc.savefig(artifact_dir / "model_roc_curves.png")
    plt.close(fig_roc)

    print(f"Evaluation curves saved → {artifact_dir}")
    return pd.DataFrame(rows)


def variant_comparison(df_base: pd.DataFrame, artifact_dir: Path) -> None:
    """
    Train all three models on four feature variants and compare PR-AUC / ROC-AUC.

    Variants
    --------
    A_base              : full feature set from feature_engineering
    B_clipped           : IQR-clipped amount + balance deltas
    C_amount_log_only   : replace raw amount with log-transformed amount
    D_balance_delta_focus: stripped-down set — balance deltas + raw amount only

    Saves
    -----
    artifacts/model_eval/model_variant_comparison.csv
    artifacts/model_eval/top3_pr_curves.png
    artifacts/model_eval/top3_roc_curves.png
    artifacts/model_eval/thresholds.json

    Parameters
    ----------
    df_base     : feature-engineered DataFrame including 'is_fraud'
    artifact_dir: output directory
    """
    from ml.eda.analysis import build_preprocessor
    from ml.training.pipeline import train_models

    def _clip(df: pd.DataFrame, cols: list) -> pd.DataFrame:
        df = df.copy()
        for col in cols:
            q1, q3 = df[col].quantile([0.25, 0.75])
            iqr = q3 - q1
            df[col] = df[col].clip(lower=q1 - 1.5 * iqr, upper=q3 + 1.5 * iqr)
        return df

    variants = {
        "A_base": df_base,
        "B_clipped": _clip(df_base, ["amount", "balance_delta_org", "balance_delta_dest"]),
        "C_amount_log_only": df_base.assign(amount=df_base["amount_log"]).drop(columns=["amount_log"], errors="ignore"),
        "D_balance_delta_focus": df_base[
            ["balance_delta_org", "balance_delta_dest", "amount",
             "oldbalanceOrg", "newbalanceOrig", "oldbalanceDest", "newbalanceDest",
             "type", "is_fraud"]
        ],
    }

    summary_rows = []
    curve_cache = {}
    for vname, dfv in variants.items():
        X = dfv.drop(columns=["is_fraud"])
        y = dfv["is_fraud"]
        X_train, X_test, y_train, y_test = train_test_split(
            X, y, test_size=0.2, random_state=RNG_SEED, stratify=y
        )
        cat_cols = [c for c in X_train.columns if pat.is_object_dtype(X_train[c]) or pat.is_string_dtype(X_train[c])]
        num_cols = [c for c in X_train.columns if c not in cat_cols]
        preprocessor = build_preprocessor(cat_cols, num_cols)
        models = train_models(X_train, y_train, preprocessor, save_models=False)

        for mname, model in models.items():
            probs = model.predict_proba(X_test)[:, 1]
            pr, rc, _ = precision_recall_curve(y_test, probs)
            fpr_curve, tpr_curve, _ = roc_curve(y_test, probs)
            pr_auc = auc(rc, pr)
            roc_auc_val = auc(fpr_curve, tpr_curve)
            curve_cache[(vname, mname)] = (rc, pr, fpr_curve, tpr_curve)
            best_pr_th, best_f1, best_roc_th = best_thresholds(y_test.to_numpy(), probs)
            summary_rows.append({
                "variant": vname,
                "model": mname,
                "pr_auc": pr_auc,
                "roc_auc": roc_auc_val,
                "precision@0.5": ((probs >= 0.5) & (y_test == 1)).sum() / max((probs >= 0.5).sum(), 1),
                "recall@0.5": ((probs >= 0.5) & (y_test == 1)).sum() / max((y_test == 1).sum(), 1),
                "best_pr_threshold": best_pr_th,
                "best_f1": best_f1,
                "best_roc_threshold": best_roc_th,
            })

    summary_df = pd.DataFrame(summary_rows)
    artifact_dir.mkdir(parents=True, exist_ok=True)
    summary_df.to_csv(artifact_dir / "model_variant_comparison.csv", index=False)
    print(f"Variant comparison saved → {artifact_dir / 'model_variant_comparison.csv'}")

    top3 = summary_df.sort_values("pr_auc", ascending=False).head(3)
    fig_pr, ax_pr = plt.subplots(figsize=(8, 6))
    fig_roc, ax_roc = plt.subplots(figsize=(8, 6))
    for _, row in top3.iterrows():
        vname, mname = row["variant"], row["model"]
        rc, pr, fpr_curve, tpr_curve = curve_cache[(vname, mname)]
        ax_pr.plot(rc, pr, label=f"{vname}-{mname} (AUC={row['pr_auc']:.3f})")
        ax_roc.plot(fpr_curve, tpr_curve, label=f"{vname}-{mname} (AUC={row['roc_auc']:.3f})")

    ax_pr.set_xlabel("Recall")
    ax_pr.set_ylabel("Precision")
    ax_pr.set_title("Top-3 Precision-Recall")
    ax_pr.legend()
    fig_pr.savefig(artifact_dir / "top3_pr_curves.png")
    plt.close(fig_pr)

    ax_roc.set_xlabel("FPR")
    ax_roc.set_ylabel("TPR")
    ax_roc.set_title("Top-3 ROC")
    ax_roc.legend()
    fig_roc.savefig(artifact_dir / "top3_roc_curves.png")
    plt.close(fig_roc)

    thresholds_json = {
        f"{r['variant']}_{r['model']}": {
            "best_pr_threshold": float(r["best_pr_threshold"]),
            "best_roc_threshold": float(r["best_roc_threshold"]),
            "pr_auc": float(r["pr_auc"]),
            "roc_auc": float(r["roc_auc"]),
        }
        for _, r in summary_df.iterrows()
    }
    th_path = artifact_dir / "thresholds.json"
    th_path.write_text(json.dumps(thresholds_json, indent=2))
    print(f"Thresholds saved → {th_path}")

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Dict, Iterable

import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from sklearn.metrics import average_precision_score, precision_recall_curve, roc_auc_score, roc_curve


@dataclass
class FraudOpsMetrics:
    pr_auc: float
    roc_auc: float
    recall_top50: float
    recall_top100: float
    precision_top50: float
    precision_top100: float
    fraud_amount_captured_top100: float
    false_positives_per_10k: float
    alert_queue_efficiency_score: float


class FraudOpsEvaluator:
    """Analyst-centric evaluation with queue-oriented metrics and curves."""

    def __init__(self, artifact_dir: Path) -> None:
        self.artifact_dir = artifact_dir
        self.artifact_dir.mkdir(parents=True, exist_ok=True)

    @staticmethod
    def _rank(y_score: np.ndarray) -> np.ndarray:
        return np.argsort(-y_score)

    @staticmethod
    def _precision_recall_at_k(y_true: np.ndarray, order: np.ndarray, k: int) -> tuple[float, float]:
        k_eff = min(max(1, k), len(y_true))
        y_top = y_true[order][:k_eff]
        precision = float(y_top.mean())
        recall = float(y_top.sum() / max(y_true.sum(), 1))
        return precision, recall

    @staticmethod
    def _fraud_amount_capture_at_k(y_true: np.ndarray, y_amount: np.ndarray, order: np.ndarray, k: int) -> float:
        k_eff = min(max(1, k), len(y_true))
        fraud_amount_total = float(y_amount[y_true == 1].sum())
        fraud_amount_top = float(y_amount[order][:k_eff][y_true[order][:k_eff] == 1].sum())
        return float(fraud_amount_top / max(fraud_amount_total, 1e-9))

    def evaluate_model(
        self,
        model_name: str,
        y_true: pd.Series,
        y_score: np.ndarray,
        y_amount: pd.Series,
    ) -> FraudOpsMetrics:
        y_np = y_true.to_numpy().astype(int)
        amount_np = y_amount.to_numpy().astype(float)
        score_np = np.asarray(y_score, dtype=float)
        order = self._rank(score_np)

        precision50, recall50 = self._precision_recall_at_k(y_np, order, 50)
        precision100, recall100 = self._precision_recall_at_k(y_np, order, 100)
        capture100 = self._fraud_amount_capture_at_k(y_np, amount_np, order, 100)

        threshold_top100 = score_np[order[min(99, len(order) - 1)]]
        y_pred = (score_np >= threshold_top100).astype(int)
        false_positives = int(((y_pred == 1) & (y_np == 0)).sum())
        false_positives_per_10k = float(false_positives / max(len(y_np), 1) * 10_000)

        queue_efficiency = (
            0.45 * precision100
            + 0.45 * recall100
            + 0.10 * max(0.0, 1.0 - min(false_positives_per_10k / 400.0, 1.0))
        )

        metrics = FraudOpsMetrics(
            pr_auc=float(average_precision_score(y_np, score_np)),
            roc_auc=float(roc_auc_score(y_np, score_np)),
            recall_top50=float(recall50),
            recall_top100=float(recall100),
            precision_top50=float(precision50),
            precision_top100=float(precision100),
            fraud_amount_captured_top100=float(capture100),
            false_positives_per_10k=float(false_positives_per_10k),
            alert_queue_efficiency_score=float(queue_efficiency),
        )

        self._save_curves(model_name=model_name, y_true=y_np, y_score=score_np, y_amount=amount_np)
        return metrics

    def evaluate_many(
        self,
        y_true: pd.Series,
        y_amount: pd.Series,
        scores_by_model: Dict[str, np.ndarray],
    ) -> pd.DataFrame:
        rows = []
        for name, scores in scores_by_model.items():
            m = self.evaluate_model(name, y_true=y_true, y_score=scores, y_amount=y_amount)
            rows.append(
                {
                    "model": name,
                    "pr_auc": m.pr_auc,
                    "roc_auc": m.roc_auc,
                    "recall_top50": m.recall_top50,
                    "recall_top100": m.recall_top100,
                    "precision_top50": m.precision_top50,
                    "precision_top100": m.precision_top100,
                    "fraud_amount_captured_top100": m.fraud_amount_captured_top100,
                    "false_positives_per_10k": m.false_positives_per_10k,
                    "alert_queue_efficiency_score": m.alert_queue_efficiency_score,
                }
            )

        df = pd.DataFrame(rows).sort_values("pr_auc", ascending=False)
        df.to_csv(self.artifact_dir / "fraud_ops_metrics.csv", index=False)
        return df

    def _save_curves(self, model_name: str, y_true: np.ndarray, y_score: np.ndarray, y_amount: np.ndarray) -> None:
        pr_precision, pr_recall, _ = precision_recall_curve(y_true, y_score)
        fpr, tpr, _ = roc_curve(y_true, y_score)

        order = np.argsort(-y_score)
        y_sorted = y_true[order]
        amount_sorted = y_amount[order]

        k = np.arange(1, len(y_sorted) + 1)
        cum_tp = np.cumsum(y_sorted)
        cum_fp = np.cumsum(1 - y_sorted)
        cum_precision = cum_tp / np.maximum(k, 1)
        cum_recall = cum_tp / max(y_sorted.sum(), 1)

        fraud_amount_total = float(y_amount[y_true == 1].sum())
        fraud_amount_captured = np.cumsum(amount_sorted * y_sorted) / max(fraud_amount_total, 1e-9)

        curve_df = pd.DataFrame(
            {
                "k": k,
                "queue_fraction": k / max(len(k), 1),
                "cum_precision": cum_precision,
                "cum_recall": cum_recall,
                "cum_false_positive_rate": cum_fp / max((y_true == 0).sum(), 1),
                "fraud_amount_capture": fraud_amount_captured,
            }
        )
        curve_df.to_csv(self.artifact_dir / f"{model_name}_queue_curves.csv", index=False)

        fig_pr, ax_pr = plt.subplots(figsize=(7.5, 5.5))
        ax_pr.plot(pr_recall, pr_precision)
        ax_pr.set_title(f"PR Curve - {model_name}")
        ax_pr.set_xlabel("Recall")
        ax_pr.set_ylabel("Precision")
        fig_pr.tight_layout()
        fig_pr.savefig(self.artifact_dir / f"{model_name}_pr_curve.png")
        plt.close(fig_pr)

        fig_roc, ax_roc = plt.subplots(figsize=(7.5, 5.5))
        ax_roc.plot(fpr, tpr)
        ax_roc.plot([0, 1], [0, 1], linestyle="--", alpha=0.5)
        ax_roc.set_title(f"ROC Curve - {model_name}")
        ax_roc.set_xlabel("False Positive Rate")
        ax_roc.set_ylabel("True Positive Rate")
        fig_roc.tight_layout()
        fig_roc.savefig(self.artifact_dir / f"{model_name}_roc_curve.png")
        plt.close(fig_roc)

        fig_queue, ax_queue = plt.subplots(figsize=(7.5, 5.5))
        ax_queue.plot(curve_df["queue_fraction"], curve_df["cum_recall"], label="cumulative analyst queue gain")
        ax_queue.plot(curve_df["queue_fraction"], curve_df["cum_precision"], label="queue precision")
        ax_queue.set_title(f"Analyst Queue Gain - {model_name}")
        ax_queue.set_xlabel("Queue Fraction Reviewed")
        ax_queue.set_ylabel("Value")
        ax_queue.legend()
        fig_queue.tight_layout()
        fig_queue.savefig(self.artifact_dir / f"{model_name}_queue_gain_curve.png")
        plt.close(fig_queue)

        fig_capture, ax_capture = plt.subplots(figsize=(7.5, 5.5))
        ax_capture.plot(curve_df["queue_fraction"], curve_df["fraud_amount_capture"])
        ax_capture.set_title(f"Fraud Capture Curve - {model_name}")
        ax_capture.set_xlabel("Queue Fraction Reviewed")
        ax_capture.set_ylabel("Fraud Amount Captured")
        fig_capture.tight_layout()
        fig_capture.savefig(self.artifact_dir / f"{model_name}_fraud_capture_curve.png")
        plt.close(fig_capture)

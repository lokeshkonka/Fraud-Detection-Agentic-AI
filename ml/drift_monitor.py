from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List

import numpy as np
import pandas as pd


@dataclass
class DriftReport:
    psi: float
    ks: float
    fraud_prevalence_shift: float
    shap_importance_shift: float
    queue_precision_degradation: float
    threshold_decay_alert: bool
    alerts: List[str]


class DriftMonitorV2:
    """Baseline and live drift monitor for fraud ops and model governance."""

    def __init__(self, baseline_path: Path) -> None:
        self.baseline_path = baseline_path
        self.baseline_path.parent.mkdir(parents=True, exist_ok=True)

    @staticmethod
    def _bin_psi(expected: np.ndarray, actual: np.ndarray, bins: np.ndarray) -> float:
        eps = 1e-8
        e_hist, _ = np.histogram(expected, bins=bins)
        a_hist, _ = np.histogram(actual, bins=bins)
        e_pct = e_hist / max(e_hist.sum(), 1)
        a_pct = a_hist / max(a_hist.sum(), 1)
        e_pct = np.clip(e_pct, eps, None)
        a_pct = np.clip(a_pct, eps, None)
        return float(np.sum((a_pct - e_pct) * np.log(a_pct / e_pct)))

    @staticmethod
    def _ks_stat(expected: np.ndarray, actual: np.ndarray) -> float:
        expected_sorted = np.sort(expected)
        actual_sorted = np.sort(actual)
        all_vals = np.sort(np.unique(np.concatenate([expected_sorted, actual_sorted])))
        e_cdf = np.searchsorted(expected_sorted, all_vals, side="right") / max(len(expected_sorted), 1)
        a_cdf = np.searchsorted(actual_sorted, all_vals, side="right") / max(len(actual_sorted), 1)
        return float(np.max(np.abs(e_cdf - a_cdf)))

    @staticmethod
    def _precision_top_k(y_true: np.ndarray, y_score: np.ndarray, k: int) -> float:
        order = np.argsort(-y_score)
        y_top = y_true[order][: min(max(k, 1), len(y_true))]
        return float(y_top.mean())

    @staticmethod
    def _shap_shift(baseline_shap: Dict[str, float], current_shap: Dict[str, float]) -> float:
        keys = sorted(set(baseline_shap.keys()).union(current_shap.keys()))
        if not keys:
            return 0.0
        b = np.asarray([baseline_shap.get(k, 0.0) for k in keys], dtype=float)
        c = np.asarray([current_shap.get(k, 0.0) for k in keys], dtype=float)
        if b.sum() > 0:
            b = b / b.sum()
        if c.sum() > 0:
            c = c / c.sum()
        return float(np.abs(b - c).sum() / 2.0)

    def build_baseline(
        self,
        reference_df: pd.DataFrame,
        reference_y: pd.Series,
        reference_scores: np.ndarray,
        shap_importance: Dict[str, float],
        threshold: float,
    ) -> Dict[str, object]:
        numeric_cols = [
            c for c in reference_df.columns if pd.api.types.is_numeric_dtype(reference_df[c]) and c not in {"is_fraud"}
        ]

        features: Dict[str, Dict[str, object]] = {}
        for col in numeric_cols:
            values = reference_df[col].astype(float).to_numpy()
            bins = np.unique(np.quantile(values, q=np.linspace(0.0, 1.0, 11)))
            if len(bins) < 3:
                bins = np.array([values.min() - 1e-6, values.mean(), values.max() + 1e-6])
            features[col] = {
                "bins": [float(x) for x in bins.tolist()],
                "reference_sample": [float(x) for x in values[:2000].tolist()],
            }

        y_np = reference_y.to_numpy().astype(int)
        score_np = np.asarray(reference_scores, dtype=float)
        queue_precision = self._precision_top_k(y_np, score_np, k=100)

        baseline = {
            "generated_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
            "fraud_prevalence": float(y_np.mean()),
            "threshold": float(threshold),
            "threshold_precision": float(((score_np >= threshold) & (y_np == 1)).sum() / max((score_np >= threshold).sum(), 1)),
            "queue_precision_top100": float(queue_precision),
            "features": features,
            "shap_importance": {k: float(v) for k, v in shap_importance.items()},
        }
        self.baseline_path.write_text(json.dumps(baseline, indent=2))
        return baseline

    def detect(
        self,
        current_df: pd.DataFrame,
        current_y: pd.Series,
        current_scores: np.ndarray,
        current_shap_importance: Dict[str, float],
    ) -> DriftReport:
        if not self.baseline_path.exists():
            raise FileNotFoundError(f"Baseline not found: {self.baseline_path}")

        baseline = json.loads(self.baseline_path.read_text())
        y_np = current_y.to_numpy().astype(int)
        score_np = np.asarray(current_scores, dtype=float)

        psi_values: List[float] = []
        ks_values: List[float] = []
        for col, meta in baseline["features"].items():
            if col not in current_df.columns:
                continue
            current_vals = current_df[col].astype(float).to_numpy()
            expected_vals = np.asarray(meta["reference_sample"], dtype=float)
            bins = np.asarray(meta["bins"], dtype=float)
            if len(np.unique(current_vals)) < 2 or len(np.unique(expected_vals)) < 2:
                continue
            psi_values.append(self._bin_psi(expected_vals, current_vals, bins=bins))
            ks_values.append(self._ks_stat(expected_vals, current_vals))

        psi = float(np.mean(psi_values)) if psi_values else 0.0
        ks = float(np.max(ks_values)) if ks_values else 0.0

        prevalence_shift = float(abs(y_np.mean() - float(baseline["fraud_prevalence"])))
        shap_shift = self._shap_shift(baseline_shap=baseline.get("shap_importance", {}), current_shap=current_shap_importance)

        current_queue_precision = self._precision_top_k(y_np, score_np, k=100)
        queue_degradation = float(max(0.0, float(baseline.get("queue_precision_top100", 0.0)) - current_queue_precision))

        threshold = float(baseline.get("threshold", 0.5))
        current_threshold_precision = float(((score_np >= threshold) & (y_np == 1)).sum() / max((score_np >= threshold).sum(), 1))
        baseline_threshold_precision = float(baseline.get("threshold_precision", 0.0))
        threshold_decay_alert = bool(
            current_threshold_precision < 0.85 * max(baseline_threshold_precision, 1e-6)
        )

        alerts: List[str] = []
        if psi > 0.20:
            alerts.append("psi_shift")
        if ks > 0.20:
            alerts.append("ks_shift")
        if prevalence_shift > 0.02:
            alerts.append("fraud_prevalence_shift")
        if shap_shift > 0.25:
            alerts.append("shap_importance_shift")
        if queue_degradation > 0.08:
            alerts.append("queue_precision_degradation")
        if threshold_decay_alert:
            alerts.append("threshold_decay_alert")

        return DriftReport(
            psi=psi,
            ks=ks,
            fraud_prevalence_shift=prevalence_shift,
            shap_importance_shift=shap_shift,
            queue_precision_degradation=queue_degradation,
            threshold_decay_alert=threshold_decay_alert,
            alerts=alerts,
        )

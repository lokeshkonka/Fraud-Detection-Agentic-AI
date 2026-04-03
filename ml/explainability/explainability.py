from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, List

import numpy as np
import pandas as pd

try:
    import shap

    HAS_SHAP = True
except Exception:
    HAS_SHAP = False

from ml.trainer import ModelBundle


@dataclass
class AnalystExplanation:
    transaction_id: str
    score: float
    top_3_shap_features: List[str]
    plain_english_reason: str
    fraud_archetype_guess: str
    risk_score_band: str
    suggested_action: str


class AnalystExplainer:
    """Analyst-oriented SHAP explanations with action guidance."""

    REASON_TEMPLATES: Dict[str, str] = {
        "amount_vs_sender_avg": "amount is much higher than the sender's normal behavior",
        "sender_amount_zscore": "transaction amount is an outlier for the sender",
        "is_new_receiver_for_sender": "receiver is new for this sender",
        "device_new_for_sender": "transaction originates from a new device",
        "geo_new_for_sender": "geo location is new for the sender",
        "burst_density_score": "multiple transfers occurred in a short time window",
        "high_velocity_new_receiver": "sender rapidly transacted with a new receiver",
        "fanout_score": "sender is fan-out transferring to many beneficiaries",
        "mule_cluster_score": "receiver is connected to a mule-like cluster",
        "repeated_cashout_score": "downstream accounts show repeated cash-out behavior",
        "partial_balance_drain": "pattern indicates partial balance drain behavior",
        "rapid_sequential_transfer": "rapid sequential transfer pattern was detected",
    }

    def _risk_band(self, score: float) -> str:
        if score >= 0.90:
            return "critical"
        if score >= 0.75:
            return "high"
        if score >= 0.55:
            return "medium"
        return "low"

    def _suggested_action(self, score: float, archetype: str) -> str:
        band = self._risk_band(score)
        if band == "critical":
            return "block"
        if band == "high" and archetype in {"Account Takeover", "Mule Network"}:
            return "block"
        if band == "high":
            return "analyst review"
        if band == "medium":
            return "OTP challenge"
        return "analyst review"

    @staticmethod
    def _guess_archetype(row: pd.Series) -> str:
        if row.get("high_velocity_new_receiver", 0) == 1 and row.get("device_new_for_sender", 0) == 1:
            return "Account Takeover"
        if row.get("fanout_score", 0.0) > 0.45 and row.get("mule_cluster_score", 0.0) > 1.2:
            return "Mule Network"
        if row.get("suspicious_round_amount", 0) == 1 and row.get("sender_txn_count_last_24_steps", 0) >= 4:
            return "Smurfing"
        if row.get("receiver_in_degree", 0.0) > 5.0 and row.get("repeated_cashout_score", 0.0) > 0.2:
            return "Layering"
        return "General Fraud Anomaly"

    def _shap_values(self, model_bundle: ModelBundle, X: pd.DataFrame) -> np.ndarray:
        X_t = model_bundle.preprocessor.transform(X)
        if not HAS_SHAP:
            return np.zeros((len(X), len(model_bundle.feature_names)), dtype=float)

        estimator = model_bundle.estimator
        try:
            if hasattr(estimator, "get_booster"):
                explainer = shap.TreeExplainer(estimator)
                vals = explainer.shap_values(X_t)
            elif estimator.__class__.__name__.lower().startswith("logistic"):
                background = X_t[: min(200, X_t.shape[0])]
                explainer = shap.LinearExplainer(estimator, background)
                vals = explainer.shap_values(X_t)
            else:
                return np.zeros((len(X), len(model_bundle.feature_names)), dtype=float)
        except Exception:
            return np.zeros((len(X), len(model_bundle.feature_names)), dtype=float)

        if isinstance(vals, list):
            vals = vals[1] if len(vals) > 1 else vals[0]

        arr = np.asarray(vals)
        if arr.ndim == 3:
            arr = arr[:, :, 1] if arr.shape[-1] > 1 else arr[:, :, 0]
        return arr

    def explain_flagged_transactions(
        self,
        model_bundle: ModelBundle,
        X: pd.DataFrame,
        scores: np.ndarray,
        threshold: float = 0.65,
        max_rows: int = 200,
    ) -> pd.DataFrame:
        """Return analyst explanations for flagged transactions."""
        probs = np.asarray(scores, dtype=float)
        flagged_idx = np.where(probs >= threshold)[0]
        if len(flagged_idx) == 0:
            return pd.DataFrame(
                columns=[
                    "transaction_id",
                    "score",
                    "top_3_shap_features",
                    "plain_english_reason",
                    "fraud_archetype_guess",
                    "risk_score_band",
                    "suggested_action",
                ]
            )

        flagged_idx = flagged_idx[:max_rows]
        X_flagged = X.iloc[flagged_idx].copy().reset_index(drop=True)
        shap_vals = self._shap_values(model_bundle, X_flagged)

        explanations: List[AnalystExplanation] = []
        for i, (_, row) in enumerate(X_flagged.iterrows()):
            if shap_vals.shape[0] > i:
                vals = shap_vals[i]
                top_idx = np.argsort(np.abs(vals))[::-1][:3]
                top_features = [model_bundle.feature_names[j] for j in top_idx]
            else:
                fallback = [
                    c
                    for c in [
                        "amount_vs_sender_avg",
                        "is_new_receiver_for_sender",
                        "high_velocity_new_receiver",
                        "mule_cluster_score",
                    ]
                    if c in X_flagged.columns
                ]
                top_features = fallback[:3] if fallback else ["risk_signal_1", "risk_signal_2", "risk_signal_3"]

            normalized_names = [f.split("__")[-1] for f in top_features]
            reasons = [
                self.REASON_TEMPLATES[name]
                for name in normalized_names
                if name in self.REASON_TEMPLATES
            ]
            plain_reason = "; ".join(reasons[:2]) if reasons else "multiple behavioral risk signals increased fraud likelihood"

            score = float(probs[flagged_idx[i]])
            archetype = self._guess_archetype(row)
            tx_id = str(row["transaction_id"]) if "transaction_id" in row else f"row_{flagged_idx[i]}"

            explanations.append(
                AnalystExplanation(
                    transaction_id=tx_id,
                    score=round(score, 6),
                    top_3_shap_features=normalized_names[:3],
                    plain_english_reason=plain_reason,
                    fraud_archetype_guess=archetype,
                    risk_score_band=self._risk_band(score),
                    suggested_action=self._suggested_action(score, archetype),
                )
            )

        return pd.DataFrame([e.__dict__ for e in explanations])

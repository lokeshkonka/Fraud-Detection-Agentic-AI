from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Dict

import numpy as np
import pandas as pd

from ml.evaluator import FraudOpsEvaluator


@dataclass
class PromotionDecision:
    recommended_model: str
    reason: str
    comparison_table: pd.DataFrame


def build_rules_ml_hybrid_score(behavior_scores: np.ndarray, df: pd.DataFrame) -> np.ndarray:
    """Hybrid score combining behavior model with rules intensity."""
    behavior = np.asarray(behavior_scores, dtype=float)

    rule_components = np.zeros(len(df), dtype=float)
    for col, weight in [
        ("high_velocity_new_receiver", 0.22),
        ("rapid_sequential_transfer", 0.18),
        ("partial_balance_drain", 0.15),
        ("is_new_receiver_for_sender", 0.14),
        ("device_new_for_sender", 0.12),
        ("geo_new_for_sender", 0.08),
        ("suspicious_round_amount", 0.06),
        ("mule_cluster_score", 0.05),
    ]:
        if col in df.columns:
            vals = np.asarray(df[col], dtype=float)
            if vals.max() > 0:
                vals = vals / vals.max()
            rule_components += weight * vals

    rule_components = np.clip(rule_components, 0.0, 1.0)
    hybrid = 0.72 * behavior + 0.28 * rule_components
    return np.clip(hybrid, 0.0, 1.0)


class ChampionChallengerManager:
    """Compares champion and challenger variants for promotion readiness."""

    def __init__(self, artifact_dir: Path) -> None:
        self.artifact_dir = artifact_dir
        self.artifact_dir.mkdir(parents=True, exist_ok=True)
        self.evaluator = FraudOpsEvaluator(artifact_dir=artifact_dir)

    def compare(
        self,
        y_true: pd.Series,
        amount: pd.Series,
        champion_scores: np.ndarray,
        behavior_challenger_scores: np.ndarray,
        feature_df: pd.DataFrame,
    ) -> PromotionDecision:
        hybrid_scores = build_rules_ml_hybrid_score(behavior_challenger_scores, feature_df)

        score_map: Dict[str, np.ndarray] = {
            "xgb_champion": np.asarray(champion_scores, dtype=float),
            "behavior_xgb_challenger": np.asarray(behavior_challenger_scores, dtype=float),
            "rules_ml_hybrid_challenger": hybrid_scores,
        }

        comparison = self.evaluator.evaluate_many(y_true=y_true, y_amount=amount, scores_by_model=score_map)
        comparison.to_csv(self.artifact_dir / "champion_challenger_comparison.csv", index=False)

        champion_row = comparison.loc[comparison["model"] == "xgb_champion"].iloc[0]
        best_row = comparison.sort_values(
            ["pr_auc", "precision_top100", "recall_top100"], ascending=False
        ).iloc[0]

        can_promote = (
            best_row["model"] != "xgb_champion"
            and float(best_row["pr_auc"]) > float(champion_row["pr_auc"]) + 0.005
            and float(best_row["precision_top100"]) >= float(champion_row["precision_top100"]) - 0.01
        )

        if can_promote:
            reason = (
                f"Promote {best_row['model']}: better PR-AUC with no material top100 precision regression."
            )
            recommended = str(best_row["model"])
        else:
            reason = "Keep xgb_champion: challengers did not clear promotion guardrails."
            recommended = "xgb_champion"

        return PromotionDecision(recommended_model=recommended, reason=reason, comparison_table=comparison)

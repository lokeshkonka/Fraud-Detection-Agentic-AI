from __future__ import annotations

import json
import os
import sys
from pathlib import Path
from typing import Dict

import numpy as np
import pandas as pd

try:
    from ml.champion_challenger import ChampionChallengerManager
    from ml.drift_monitor import DriftMonitorV2
    from ml.evaluator import FraudOpsEvaluator
    from ml.explainability import AnalystExplainer
    from ml.feature_store import FeatureStoreV2
    from ml.fraud_simulator_v2 import FraudSimulatorV2, SimulationConfig
    from ml.temporal_split import temporal_train_val_test_split
    from ml.trainer import FraudTrainer
except ModuleNotFoundError:
    # Supports running this file directly via: python /abs/path/ml/training/pipeline.py
    repo_root = Path(__file__).resolve().parents[2]
    if str(repo_root) not in sys.path:
        sys.path.insert(0, str(repo_root))
    from ml.champion_challenger import ChampionChallengerManager
    from ml.drift_monitor import DriftMonitorV2
    from ml.evaluator import FraudOpsEvaluator
    from ml.explainability import AnalystExplainer
    from ml.feature_store import FeatureStoreV2
    from ml.fraud_simulator_v2 import FraudSimulatorV2, SimulationConfig
    from ml.temporal_split import temporal_train_val_test_split
    from ml.trainer import FraudTrainer

ROOT = Path(__file__).resolve().parent.parent.parent
DATA_PATH = Path(os.getenv("FRAUD_DATA_PATH", ROOT / "ml" / "data" / "transactions_80k.csv"))
ARTIFACT_ROOT = ROOT / "artifacts"
ARTIFACT_MODEL = ARTIFACT_ROOT / "model_eval"
ARTIFACT_SHAP = ARTIFACT_ROOT / "shap"
ARTIFACT_DRIFT = ARTIFACT_ROOT / "drift"
ARTIFACT_PIPE = ARTIFACT_ROOT / "pipeline"


def _normalize_target(df: pd.DataFrame) -> pd.DataFrame:
    if "is_fraud" in df.columns:
        return df
    if "isFraud" in df.columns:
        return df.rename(columns={"isFraud": "is_fraud"})
    raise ValueError("Dataset must include 'is_fraud' or 'isFraud'")


def _ensure_entity_columns(df: pd.DataFrame, seed: int = 42) -> pd.DataFrame:
    """Ensure sender/receiver/device/network identifiers exist for feature generation."""
    rng = np.random.default_rng(seed)
    out = df.copy()

    if "sender_id" not in out.columns:
        if "nameOrig" in out.columns:
            out["sender_id"] = out["nameOrig"].astype(str)
        else:
            out["sender_id"] = [f"acct_{i:07d}" for i in rng.integers(0, 5000, size=len(out))]

    if "receiver_id" not in out.columns:
        if "nameDest" in out.columns:
            out["receiver_id"] = out["nameDest"].astype(str)
        else:
            out["receiver_id"] = [f"acct_{i:07d}" for i in rng.integers(0, 6000, size=len(out))]

    if "device_id" not in out.columns:
        base_devices = [f"dev_{i:05d}" for i in range(3000)]
        out["device_id"] = [base_devices[abs(hash(s)) % len(base_devices)] for s in out["sender_id"].astype(str)]
        random_new = rng.random(len(out)) < 0.08
        out.loc[random_new, "device_id"] = [f"dev_{i:05d}" for i in rng.integers(0, 8000, size=int(random_new.sum()))]

    if "ip_cluster" not in out.columns:
        out["ip_cluster"] = [f"ip_{abs(hash(s + '_ip')) % 240:03d}" for s in out["sender_id"].astype(str)]

    if "geo_bucket" not in out.columns:
        out["geo_bucket"] = [f"geo_{abs(hash(s + '_geo')) % 90:03d}" for s in out["sender_id"].astype(str)]

    if "transaction_id" not in out.columns:
        out["transaction_id"] = [f"txn_{i:09d}" for i in range(len(out))]

    if "hour" not in out.columns:
        if "step" in out.columns:
            out["hour"] = out["step"].astype(int) % 24
        else:
            out["hour"] = rng.integers(0, 24, size=len(out))

    if "fraud_archetype" not in out.columns:
        out["fraud_archetype"] = np.where(out["is_fraud"] == 1, "unknown", "legit")

    return out


def _load_or_simulate(path: Path) -> pd.DataFrame:
    if path.exists():
        df = pd.read_parquet(path) if path.suffix.lower() == ".parquet" else pd.read_csv(path)
        df = _normalize_target(df)
        if "step" not in df.columns:
            df["step"] = np.arange(1, len(df) + 1)
        return _ensure_entity_columns(df)

    simulator = FraudSimulatorV2(
        SimulationConfig(
            n_rows=int(os.getenv("FRAUD_SYNTHETIC_ROWS", "120000")),
            fraud_ratio=float(os.getenv("FRAUD_RATIO", "0.08")),
            seed=int(os.getenv("FRAUD_SEED", "42")),
        )
    )
    return simulator.generate()


def run() -> None:
    for p in [ARTIFACT_MODEL, ARTIFACT_SHAP, ARTIFACT_DRIFT, ARTIFACT_PIPE]:
        p.mkdir(parents=True, exist_ok=True)

    df_raw = _load_or_simulate(DATA_PATH)
    df_features = FeatureStoreV2().build_feature_store(df_raw)

    split = temporal_train_val_test_split(df_features, step_col="step", sender_col="sender_id")
    (ARTIFACT_PIPE / "temporal_split_metadata.json").write_text(json.dumps(split.metadata, indent=2))

    trainer = FraudTrainer(artifact_dir=ARTIFACT_PIPE)
    bundles = trainer.fit(split.train, split.validation, target_col="is_fraud")

    target_col = "is_fraud"
    drop_cols = [target_col]
    for c in ["fraud_archetype"]:
        if c in split.test.columns:
            drop_cols.append(c)
    val_drop_cols = list(drop_cols)

    X_val = split.validation.drop(columns=val_drop_cols)
    y_val = split.validation[target_col].astype(int)
    X_test = split.test.drop(columns=drop_cols)
    y_test = split.test[target_col].astype(int)
    amount_test = split.test["amount"].astype(float)

    val_scores_by_model: Dict[str, np.ndarray] = {
        name: bundle.predict_proba(X_val[bundle.preprocessor.feature_names_in_])
        for name, bundle in bundles.items()
    }
    scores_by_model: Dict[str, np.ndarray] = {
        name: bundle.predict_proba(X_test[bundle.preprocessor.feature_names_in_])
        for name, bundle in bundles.items()
    }

    evaluator = FraudOpsEvaluator(artifact_dir=ARTIFACT_MODEL)
    metrics_df = evaluator.evaluate_many(y_true=y_test, y_amount=amount_test, scores_by_model=scores_by_model)

    champion_name = "xgb" if "xgb" in bundles else metrics_df.iloc[0]["model"]
    champion_bundle = bundles[str(champion_name)]
    champion_scores = scores_by_model[str(champion_name)]

    explainer = AnalystExplainer()
    explanations = explainer.explain_flagged_transactions(
        model_bundle=champion_bundle,
        X=X_test[champion_bundle.preprocessor.feature_names_in_],
        scores=champion_scores,
        threshold=float(champion_bundle.ranking_thresholds.get("threshold_top100", 0.65)),
    )
    explanations.to_csv(ARTIFACT_SHAP / "analyst_explanations.csv", index=False)

    if hasattr(champion_bundle.estimator, "get_booster"):
        shap_importance = champion_bundle.estimator.get_booster().get_score(importance_type="gain")
    else:
        shap_importance = {}

    drift_monitor = DriftMonitorV2(baseline_path=ARTIFACT_DRIFT / "drift_baseline_v2.json")
    baseline = drift_monitor.build_baseline(
        reference_df=split.validation,
        reference_y=y_val,
        reference_scores=val_scores_by_model[str(champion_name)],
        shap_importance=shap_importance,
        threshold=float(champion_bundle.ranking_thresholds.get("threshold_top100", 0.65)),
    )

    drift_report = drift_monitor.detect(
        current_df=split.test,
        current_y=y_test,
        current_scores=champion_scores,
        current_shap_importance=shap_importance,
    )
    (ARTIFACT_DRIFT / "drift_report_v2.json").write_text(json.dumps(drift_report.__dict__, indent=2))

    behavior_scores = scores_by_model.get("behavior_xgb", champion_scores)
    cc_manager = ChampionChallengerManager(artifact_dir=ARTIFACT_MODEL)
    decision = cc_manager.compare(
        y_true=y_test,
        amount=amount_test,
        champion_scores=champion_scores,
        behavior_challenger_scores=behavior_scores,
        feature_df=split.test,
    )
    (ARTIFACT_MODEL / "promotion_decision.json").write_text(
        json.dumps(
            {
                "recommended_model": decision.recommended_model,
                "reason": decision.reason,
            },
            indent=2,
        )
    )

    summary = {
        "dataset_rows": int(len(df_raw)),
        "fraud_prevalence": float(df_raw["is_fraud"].mean()),
        "champion": str(champion_name),
        "drift_alerts": drift_report.alerts,
        "promotion_recommendation": decision.recommended_model,
    }
    (ARTIFACT_PIPE / "run_summary_v2.json").write_text(json.dumps(summary, indent=2))

    print("Behavioral fraud pipeline v2 complete")
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    run()

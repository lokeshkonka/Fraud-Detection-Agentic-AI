from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Optional

import joblib
import numpy as np
import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import RandomForestClassifier
from sklearn.isotonic import IsotonicRegression
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import average_precision_score, roc_auc_score
from sklearn.preprocessing import OneHotEncoder, StandardScaler

try:
    from xgboost import XGBClassifier

    HAS_XGB = True
except Exception:
    HAS_XGB = False


@dataclass
class ModelBundle:
    """Trained model with preprocessor and metadata."""

    name: str
    preprocessor: ColumnTransformer
    estimator: object
    calibrator: Optional[object]
    feature_names: List[str]
    validation_metrics: Dict[str, float]
    ranking_thresholds: Dict[str, float]

    def predict_proba(self, X: pd.DataFrame) -> np.ndarray:
        Xt = self.preprocessor.transform(X)
        model = self.calibrator if self.calibrator is not None else self.estimator
        probs = model.predict_proba(Xt)[:, 1]
        return np.asarray(probs, dtype=float)


class IsotonicProbabilityCalibrator:
    """Calibrate model probabilities via isotonic regression on held-out data."""

    def __init__(self, estimator: object) -> None:
        self.estimator = estimator
        self.isotonic = IsotonicRegression(out_of_bounds="clip")

    def fit(self, X, y: pd.Series) -> "IsotonicProbabilityCalibrator":
        raw = self.estimator.predict_proba(X)[:, 1]
        self.isotonic.fit(raw, y)
        return self

    def predict_proba(self, X) -> np.ndarray:
        raw = self.estimator.predict_proba(X)[:, 1]
        calibrated = np.asarray(self.isotonic.transform(raw), dtype=float)
        return np.column_stack([1.0 - calibrated, calibrated])


class FraudTrainer:
    """Trainer for LR, RF, XGB champion, and behavior-focused XGB challenger."""

    def __init__(self, artifact_dir: Path, random_state: int = 42) -> None:
        self.artifact_dir = artifact_dir
        self.random_state = random_state
        self.models_dir = artifact_dir / "models"
        self.metrics_dir = artifact_dir / "metrics"
        self.models_dir.mkdir(parents=True, exist_ok=True)
        self.metrics_dir.mkdir(parents=True, exist_ok=True)

    @staticmethod
    def _feature_columns(df: pd.DataFrame, target_col: str) -> List[str]:
        drop_cols = {target_col}
        for col in ["transaction_id", "fraud_archetype"]:
            if col in df.columns:
                drop_cols.add(col)
        return [c for c in df.columns if c not in drop_cols]

    @staticmethod
    def _build_preprocessor(X: pd.DataFrame) -> ColumnTransformer:
        cat_cols = [
            c
            for c in X.columns
            if pd.api.types.is_object_dtype(X[c])
            or pd.api.types.is_string_dtype(X[c])
            or pd.api.types.is_categorical_dtype(X[c])
        ]
        num_cols = [c for c in X.columns if c not in cat_cols]
        preprocessor = ColumnTransformer(
            transformers=[
                ("num", StandardScaler(), num_cols),
                ("cat", OneHotEncoder(handle_unknown="ignore"), cat_cols),
            ]
        )
        return preprocessor

    @staticmethod
    def _class_weight(y: pd.Series) -> Dict[int, float]:
        pos = max(int(y.sum()), 1)
        neg = max(int(len(y) - pos), 1)
        w = float(neg / pos)
        return {0: 1.0, 1: w}

    @staticmethod
    def _topk_thresholds(y_true: np.ndarray, y_score: np.ndarray, ks: List[int] = [50, 100]) -> Dict[str, float]:
        order = np.argsort(-y_score)
        out: Dict[str, float] = {}
        for k in ks:
            k_eff = min(max(1, k), len(y_score))
            th = float(y_score[order[k_eff - 1]])
            y_top = y_true[order][:k_eff]
            out[f"threshold_top{k}"] = th
            out[f"precision_top{k}"] = float(y_top.mean())
            out[f"recall_top{k}"] = float(y_top.sum() / max(y_true.sum(), 1))
        return out

    @staticmethod
    def _monotone_constraints(feature_names: List[str]) -> List[int]:
        monotone_positive_prefixes = [
            "num__amount_vs_sender_avg",
            "num__sender_amount_zscore",
            "num__burst_density_score",
            "num__high_velocity_new_receiver",
            "num__partial_balance_drain",
            "num__rapid_sequential_transfer",
            "num__fanout_score",
            "num__mule_cluster_score",
        ]
        monotone_negative_prefixes = ["num__time_since_last_sender_txn"]

        constraints: List[int] = []
        for f in feature_names:
            if any(f.startswith(p) for p in monotone_positive_prefixes):
                constraints.append(1)
            elif any(f.startswith(p) for p in monotone_negative_prefixes):
                constraints.append(-1)
            else:
                constraints.append(0)
        return constraints

    def _fit_calibrator(self, model: object, X_val_t, y_val: pd.Series) -> object:
        calibrator = IsotonicProbabilityCalibrator(estimator=model)
        calibrator.fit(X_val_t, y_val)
        return calibrator

    def _bundle_metrics(self, y_val: pd.Series, scores: np.ndarray) -> Dict[str, float]:
        return {
            "pr_auc": float(average_precision_score(y_val, scores)),
            "roc_auc": float(roc_auc_score(y_val, scores)),
        }

    def fit(
        self,
        train_df: pd.DataFrame,
        validation_df: pd.DataFrame,
        target_col: str = "is_fraud",
    ) -> Dict[str, ModelBundle]:
        if target_col not in train_df.columns or target_col not in validation_df.columns:
            raise ValueError(f"Target column '{target_col}' must be present in train and validation datasets")

        feature_cols = self._feature_columns(train_df, target_col)
        X_train = train_df[feature_cols]
        y_train = train_df[target_col].astype(int)
        X_val = validation_df[feature_cols]
        y_val = validation_df[target_col].astype(int)

        preprocessor = self._build_preprocessor(X_train)
        X_train_t = preprocessor.fit_transform(X_train)
        X_val_t = preprocessor.transform(X_val)
        feature_names = list(preprocessor.get_feature_names_out())

        class_weight = self._class_weight(y_train)
        pos_weight = class_weight[1]

        bundles: Dict[str, ModelBundle] = {}

        lr = LogisticRegression(max_iter=600, class_weight=class_weight, C=0.45, random_state=self.random_state)
        lr.fit(X_train_t, y_train)
        lr_scores = lr.predict_proba(X_val_t)[:, 1]
        bundles["lr"] = ModelBundle(
            name="lr",
            preprocessor=preprocessor,
            estimator=lr,
            calibrator=None,
            feature_names=feature_names,
            validation_metrics=self._bundle_metrics(y_val, lr_scores),
            ranking_thresholds=self._topk_thresholds(y_val.to_numpy(), lr_scores),
        )

        rf = RandomForestClassifier(
            n_estimators=320,
            max_depth=16,
            min_samples_leaf=2,
            n_jobs=-1,
            class_weight=class_weight,
            random_state=self.random_state,
        )
        rf.fit(X_train_t, y_train)
        rf_scores = rf.predict_proba(X_val_t)[:, 1]
        bundles["rf"] = ModelBundle(
            name="rf",
            preprocessor=preprocessor,
            estimator=rf,
            calibrator=None,
            feature_names=feature_names,
            validation_metrics=self._bundle_metrics(y_val, rf_scores),
            ranking_thresholds=self._topk_thresholds(y_val.to_numpy(), rf_scores),
        )

        if HAS_XGB:
            monotone_constraints = self._monotone_constraints(feature_names)
            xgb = XGBClassifier(
                objective="binary:logistic",
                eval_metric="aucpr",
                random_state=self.random_state,
                n_estimators=1200,
                learning_rate=0.03,
                max_depth=6,
                min_child_weight=4,
                gamma=0.15,
                subsample=0.9,
                colsample_bytree=0.9,
                reg_lambda=1.2,
                tree_method="hist",
                scale_pos_weight=float(pos_weight),
                monotone_constraints=tuple(monotone_constraints),
            )
            xgb.fit(
                X_train_t,
                y_train,
                eval_set=[(X_val_t, y_val)],
                verbose=False,
            )

            xgb_calibrator = self._fit_calibrator(xgb, X_val_t, y_val)
            xgb_scores = xgb_calibrator.predict_proba(X_val_t)[:, 1]

            bundles["xgb"] = ModelBundle(
                name="xgb",
                preprocessor=preprocessor,
                estimator=xgb,
                calibrator=xgb_calibrator,
                feature_names=feature_names,
                validation_metrics=self._bundle_metrics(y_val, xgb_scores),
                ranking_thresholds=self._topk_thresholds(y_val.to_numpy(), xgb_scores),
            )

            behavior_features = [
                c
                for c in feature_cols
                if (
                    "sender_txn_count" in c
                    or "receiver_incoming" in c
                    or "new_receiver" in c
                    or "device_new" in c
                    or "geo_new" in c
                    or "amount_vs_sender_avg" in c
                    or "sender_amount_zscore" in c
                    or "night" in c
                    or "burst" in c
                    or "time_since_last" in c
                    or "degree" in c
                    or "fanout" in c
                    or "mule" in c
                    or "cashout" in c
                    or "suspicious" in c
                    or "partial_balance_drain" in c
                    or "rapid" in c
                    or "high_velocity" in c
                )
            ]
            if behavior_features:
                X_train_b = train_df[behavior_features]
                X_val_b = validation_df[behavior_features]
                pre_b = self._build_preprocessor(X_train_b)
                X_train_bt = pre_b.fit_transform(X_train_b)
                X_val_bt = pre_b.transform(X_val_b)
                names_b = list(pre_b.get_feature_names_out())

                behavior_xgb = XGBClassifier(
                    objective="binary:logistic",
                    eval_metric="aucpr",
                    random_state=self.random_state,
                    n_estimators=1000,
                    learning_rate=0.035,
                    max_depth=5,
                    min_child_weight=3,
                    gamma=0.1,
                    subsample=0.92,
                    colsample_bytree=0.92,
                    reg_lambda=1.0,
                    tree_method="hist",
                    scale_pos_weight=float(pos_weight),
                    monotone_constraints=tuple(self._monotone_constraints(names_b)),
                )
                behavior_xgb.fit(X_train_bt, y_train, eval_set=[(X_val_bt, y_val)], verbose=False)
                behavior_cal = self._fit_calibrator(behavior_xgb, X_val_bt, y_val)
                behavior_scores = behavior_cal.predict_proba(X_val_bt)[:, 1]

                bundles["behavior_xgb"] = ModelBundle(
                    name="behavior_xgb",
                    preprocessor=pre_b,
                    estimator=behavior_xgb,
                    calibrator=behavior_cal,
                    feature_names=names_b,
                    validation_metrics=self._bundle_metrics(y_val, behavior_scores),
                    ranking_thresholds=self._topk_thresholds(y_val.to_numpy(), behavior_scores),
                )

                imp_gain = bundles["behavior_xgb"].estimator.get_booster().get_score(importance_type="gain")
                importance_df = pd.DataFrame(
                    [{"feature": k, "gain": float(v)} for k, v in imp_gain.items()]
                ).sort_values("gain", ascending=False)
                importance_df.to_csv(self.metrics_dir / "behavior_xgb_feature_importance.csv", index=False)

            imp_gain_xgb = bundles["xgb"].estimator.get_booster().get_score(importance_type="gain")
            importance_df_xgb = pd.DataFrame(
                [{"feature": k, "gain": float(v)} for k, v in imp_gain_xgb.items()]
            ).sort_values("gain", ascending=False)
            importance_df_xgb.to_csv(self.metrics_dir / "xgb_feature_importance.csv", index=False)

        for name, bundle in bundles.items():
            joblib.dump(bundle, self.models_dir / f"{name}.joblib")

        model_registry = {
            name: {
                "validation_metrics": bundle.validation_metrics,
                "ranking_thresholds": bundle.ranking_thresholds,
            }
            for name, bundle in bundles.items()
        }
        (self.metrics_dir / "model_registry.json").write_text(json.dumps(model_registry, indent=2))

        return bundles

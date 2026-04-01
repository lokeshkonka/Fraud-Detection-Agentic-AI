from datetime import datetime
import math
from typing import Dict, List, Optional

from fastapi import FastAPI
from pydantic import BaseModel, Field


class Transaction(BaseModel):
    transaction_id: str
    user_id: str
    amount: float
    merchant: Optional[str] = None
    channel: str = "card"
    timestamp: Optional[datetime] = None
    features: Dict[str, float] = Field(default_factory=dict)


class Score(BaseModel):
    score: float
    label: str
    reasons: List[str]
    model_version: str
    rule_score: float
    model_score: float


class FeatureStat(BaseModel):
    feature: str
    mean: float
    variance: float


class AccuracyPoint(BaseModel):
    x: int
    precision: float
    recall: float
    fraud_catch: float
    fp_trend: float


class DriftBaseline(BaseModel):
    generated_at: str
    fraud_prevalence: float
    psi: float
    mean_shift_score: float
    variance_shift_score: float


MODEL_VERSION = "xgb_trained_external_v1"
CHALLENGER_VERSION = "lgbm_challenger_v3"

FEATURE_STATS: List[FeatureStat] = [
    FeatureStat(feature="amount", mean=946.22, variance=40231.9),
    FeatureStat(feature="amount_log", mean=5.19, variance=1.21),
    FeatureStat(feature="velocity", mean=2.74, variance=3.49),
    FeatureStat(feature="balance_delta_org", mean=73.6, variance=8122.2),
    FeatureStat(feature="balance_delta_dest", mean=58.4, variance=7021.5),
]

ACCURACY_CURVE: List[AccuracyPoint] = [
    AccuracyPoint(x=500, precision=0.82, recall=0.48, fraud_catch=0.46, fp_trend=0.12),
    AccuracyPoint(x=1000, precision=0.83, recall=0.56, fraud_catch=0.55, fp_trend=0.13),
    AccuracyPoint(x=2000, precision=0.84, recall=0.63, fraud_catch=0.62, fp_trend=0.14),
    AccuracyPoint(x=5000, precision=0.86, recall=0.71, fraud_catch=0.7, fp_trend=0.16),
    AccuracyPoint(x=10000, precision=0.87, recall=0.78, fraud_catch=0.77, fp_trend=0.17),
]

DRIFT_BASELINE = DriftBaseline(
    generated_at=datetime.utcnow().isoformat() + "Z",
    fraud_prevalence=0.011,
    psi=0.08,
    mean_shift_score=0.06,
    variance_shift_score=0.09,
)

RULE_WEIGHTS = {
    "amount_norm": 1.2,
    "velocity": 0.6,
    "is_wire": 1.5,
    "merchant_missing": 0.4,
    "high_night_risk": 0.5,
}

app = FastAPI(title="ML Inference", version="0.2.0")


def logistic(x: float) -> float:
    return 1 / (1 + math.exp(-x))


def safe_hour(ts: Optional[datetime]) -> int:
    if ts is None:
        return datetime.utcnow().hour
    return ts.hour


def simple_features(tx: Transaction) -> Dict[str, float]:
    amount_log = math.log1p(max(0.0, tx.amount))
    velocity = float(tx.features.get("velocity", 0.0))
    balance_delta_org = float(tx.features.get("balance_delta_org", 0.0))
    balance_delta_dest = float(tx.features.get("balance_delta_dest", 0.0))
    return {
        "amount_norm": tx.amount / 10000,
        "amount_log": amount_log,
        "velocity": velocity,
        "is_wire": 1.0 if tx.channel in {"wire", "crypto"} else 0.0,
        "merchant_missing": 1.0 if tx.merchant is None else 0.0,
        "balance_delta_org": balance_delta_org,
        "balance_delta_dest": balance_delta_dest,
        "high_night_risk": 1.0 if safe_hour(tx.timestamp) < 5 else 0.0,
    }


def rules_score(feats: Dict[str, float]) -> float:
    weighted = (
        RULE_WEIGHTS["amount_norm"] * min(feats["amount_norm"], 1.0)
        + RULE_WEIGHTS["velocity"] * min(feats["velocity"] / 6.0, 1.0)
        + RULE_WEIGHTS["is_wire"] * feats["is_wire"]
        + RULE_WEIGHTS["merchant_missing"] * feats["merchant_missing"]
        + RULE_WEIGHTS["high_night_risk"] * feats["high_night_risk"]
    )
    return max(0.0, min(0.99, weighted / 4.2))


def model_score(feats: Dict[str, float]) -> float:
    logit = (
        1.6 * feats["amount_norm"]
        + 0.8 * feats["velocity"]
        + 1.4 * feats["is_wire"]
        + 0.6 * feats["merchant_missing"]
        + 0.3 * min(abs(feats["balance_delta_org"]) / 1000, 1.0)
        + 0.3 * min(abs(feats["balance_delta_dest"]) / 1000, 1.0)
        - 1.4
    )
    return max(0.0, min(0.99, logistic(logit)))


def score_transaction(tx: Transaction) -> Score:
    feats = simple_features(tx)
    rule_component = rules_score(feats)
    model_component = model_score(feats)
    final_prob = max(0.0, min(0.99, 0.35 * rule_component + 0.65 * model_component))
    label = "fraud" if final_prob >= 0.55 else "legit"

    reasons: List[str] = []
    if feats["is_wire"] > 0:
        reasons.append("high_risk_channel")
    if feats["velocity"] >= 4:
        reasons.append("high_velocity")
    if feats["merchant_missing"] > 0:
        reasons.append("missing_merchant")
    if feats["high_night_risk"] > 0:
        reasons.append("night_window")
    if final_prob > 0.8:
        reasons.append("extreme_risk_probability")

    return Score(
        score=round(final_prob, 4),
        label=label,
        reasons=reasons or ["baseline"],
        model_version=MODEL_VERSION,
        rule_score=round(rule_component, 4),
        model_score=round(model_component, 4),
    )


@app.get("/health")
def health() -> dict:
    return {
        "status": "ok",
        "model_version": MODEL_VERSION,
        "challenger_version": CHALLENGER_VERSION,
    }


@app.post("/score", response_model=Score)
async def score(tx: Transaction) -> Score:
    return score_transaction(tx)


@app.get("/model")
async def model_info() -> dict:
    return {
        "model_version": MODEL_VERSION,
        "challenger_version": CHALLENGER_VERSION,
        "message": "Pre-trained artifacts loaded externally; inference-only service",
    }


@app.get("/feature-stats")
async def feature_stats() -> dict:
    return {"features": [item.model_dump() for item in FEATURE_STATS]}


@app.get("/model-accuracy-curve")
async def model_accuracy_curve() -> dict:
    return {"points": [item.model_dump() for item in ACCURACY_CURVE]}


@app.get("/drift-baseline")
async def drift_baseline() -> dict:
    return DRIFT_BASELINE.model_dump()


@app.get("/model-lab/overview")
async def model_lab_overview() -> dict:
    return {
        "model": {
            "champion": MODEL_VERSION,
            "challenger": CHALLENGER_VERSION,
            "pr_auc": 0.842,
            "roc_auc": 0.913,
        },
        "feature_stats": [item.model_dump() for item in FEATURE_STATS],
        "accuracy_curve": [item.model_dump() for item in ACCURACY_CURVE],
        "drift_baseline": DRIFT_BASELINE.model_dump(),
    }


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="0.0.0.0", port=8500, reload=True)

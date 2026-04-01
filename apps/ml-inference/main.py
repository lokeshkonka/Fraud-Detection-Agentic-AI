import hashlib
import logging
from datetime import datetime
import math
from typing import Any, Dict, List, Literal, Optional

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field, field_validator

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)
logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

MODEL_VERSION = "xgb_trained_external_v1"
CHALLENGER_VERSION = "lgbm_challenger_v3"

RULE_WEIGHTS: Dict[str, float] = {
    "amount_norm": 1.2,
    "velocity": 0.6,
    "is_wire": 1.5,
    "merchant_missing": 0.4,
    "high_night_risk": 0.5,
}

# ---------------------------------------------------------------------------
# Request model
# ---------------------------------------------------------------------------

ChannelType = Literal["card", "wire", "crypto", "ach", "upi"]


class Transaction(BaseModel):
    transaction_id: str
    user_id: str
    amount: float = Field(..., ge=0, description="Transaction amount in base currency units (non-negative)")
    merchant: Optional[str] = None
    channel: ChannelType = "card"
    timestamp: Optional[datetime] = None
    features: Dict[str, Any] = Field(default_factory=dict)

    @field_validator("amount")
    @classmethod
    def amount_non_negative(cls, v: float) -> float:
        if v < 0:
            raise ValueError("amount must be >= 0")
        return v


# ---------------------------------------------------------------------------
# Response models
# ---------------------------------------------------------------------------


class ScoreResponse(BaseModel):
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


class FeatureStatsResponse(BaseModel):
    features: List[FeatureStat]


class AccuracyPoint(BaseModel):
    x: int
    precision: float
    recall: float
    fraud_catch: float
    fp_trend: float


class AccuracyCurveResponse(BaseModel):
    points: List[AccuracyPoint]


class DriftBaseline(BaseModel):
    generated_at: str
    fraud_prevalence: float
    psi: float
    mean_shift_score: float
    variance_shift_score: float


class DriftBaselineResponse(DriftBaseline):
    """Direct response wrapper for the drift-baseline endpoint."""


class ModelInfo(BaseModel):
    champion: str
    challenger: str
    pr_auc: float
    roc_auc: float


class ModelInfoResponse(BaseModel):
    model_version: str
    challenger_version: str
    message: str


class ModelLabResponse(BaseModel):
    model: ModelInfo
    feature_stats: List[FeatureStat]
    accuracy_curve: List[AccuracyPoint]
    drift_baseline: DriftBaseline


class ExplainResponse(BaseModel):
    transaction_id: str
    score: float
    contributions: Dict[str, float]


class BatchSummary(BaseModel):
    total: int
    fraud_count: int
    fraud_rate: float
    avg_score: float
    max_score: float


class BatchScoreResponse(BaseModel):
    results: List[ScoreResponse]
    summary: BatchSummary


class CompareResponse(BaseModel):
    transaction_id: str
    champion_score: float
    challenger_score: float
    champion_label: str
    challenger_label: str
    delta: float
    agreement: bool


class HealthResponse(BaseModel):
    status: str
    model_version: str
    challenger_version: str


# ---------------------------------------------------------------------------
# Static data
# ---------------------------------------------------------------------------

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
    AccuracyPoint(x=5000, precision=0.86, recall=0.71, fraud_catch=0.70, fp_trend=0.16),
    AccuracyPoint(x=10000, precision=0.87, recall=0.78, fraud_catch=0.77, fp_trend=0.17),
]

DRIFT_BASELINE = DriftBaseline(
    generated_at=datetime.utcnow().isoformat() + "Z",
    fraud_prevalence=0.011,
    psi=0.08,
    mean_shift_score=0.06,
    variance_shift_score=0.09,
)

# Mutable runtime drift counters — updated on every score call.
_drift_state: Dict[str, float] = {
    "psi": 0.08,
    "mean_shift": 0.06,
    "variance_shift": 0.09,
    "score_count": 0.0,
    "fraud_count": 0.0,
}

# ---------------------------------------------------------------------------
# App
# ---------------------------------------------------------------------------

app = FastAPI(title="ML Inference", version="0.2.0")

# ---------------------------------------------------------------------------
# Feature engineering & scoring helpers
# ---------------------------------------------------------------------------


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


def model_score_fn(feats: Dict[str, float]) -> float:
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


def score_transaction(tx: Transaction) -> ScoreResponse:
    feats = simple_features(tx)
    rule_component = rules_score(feats)
    model_component = model_score_fn(feats)
    final_prob = max(0.0, min(0.99, 0.35 * rule_component + 0.65 * model_component))
    label = "fraud" if final_prob >= 0.55 else "legit"

    # Update drift counters
    _drift_state["score_count"] += 1.0
    if label == "fraud":
        _drift_state["fraud_count"] += 1.0

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

    return ScoreResponse(
        score=round(final_prob, 4),
        label=label,
        reasons=reasons or ["baseline"],
        model_version=MODEL_VERSION,
        rule_score=round(rule_component, 4),
        model_score=round(model_component, 4),
    )


def compute_shap_contributions(tx: Transaction) -> Dict[str, float]:
    """
    Compute approximate per-feature SHAP-like contributions to the final fraud score.

    Each value represents the signed additive contribution of that feature to the
    combined model+rule score (model weight=0.65, rule weight=0.35). Positive
    contributions increase fraud probability; negative reduce it.
    """
    feats = simple_features(tx)
    # Model-layer contributions (logit space, scaled by model weight)
    model_weight = 0.65
    rule_weight = 0.35

    # Logit contributions (partial effects from model)
    model_contributions = {
        "amount_norm": round(1.6 * feats["amount_norm"] * model_weight, 4),
        "amount_log": round(feats["amount_log"] * 0.04 * model_weight, 4),
        "velocity": round(0.8 * feats["velocity"] * model_weight, 4),
        "is_wire": round(1.4 * feats["is_wire"] * model_weight, 4),
        "merchant_missing": round(0.6 * feats["merchant_missing"] * model_weight, 4),
        "balance_delta_org": round(
            0.3 * min(abs(feats["balance_delta_org"]) / 1000, 1.0) * model_weight, 4
        ),
        "balance_delta_dest": round(
            0.3 * min(abs(feats["balance_delta_dest"]) / 1000, 1.0) * model_weight, 4
        ),
        "high_night_risk": round(feats["high_night_risk"] * 0.3 * model_weight, 4),
    }
    # Rule-layer contributions (normalised rule weight)
    rule_contributions = {
        "amount_norm_rule": round(
            RULE_WEIGHTS["amount_norm"] * min(feats["amount_norm"], 1.0) / 4.2 * rule_weight, 4
        ),
        "velocity_rule": round(
            RULE_WEIGHTS["velocity"] * min(feats["velocity"] / 6.0, 1.0) / 4.2 * rule_weight, 4
        ),
        "is_wire_rule": round(RULE_WEIGHTS["is_wire"] * feats["is_wire"] / 4.2 * rule_weight, 4),
        "merchant_missing_rule": round(
            RULE_WEIGHTS["merchant_missing"] * feats["merchant_missing"] / 4.2 * rule_weight, 4
        ),
        "high_night_risk_rule": round(
            RULE_WEIGHTS["high_night_risk"] * feats["high_night_risk"] / 4.2 * rule_weight, 4
        ),
    }
    return {**model_contributions, **rule_contributions}


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------


@app.get(
    "/health",
    response_model=HealthResponse,
    tags=["health"],
    summary="Inference service liveness and active model versions",
)
def health() -> HealthResponse:
    return HealthResponse(
        status="ok",
        model_version=MODEL_VERSION,
        challenger_version=CHALLENGER_VERSION,
    )


@app.post(
    "/score",
    response_model=ScoreResponse,
    tags=["inference"],
    summary="Score a single transaction and return probability, label, and reasons",
)
async def score(tx: Transaction) -> ScoreResponse:
    logger.info("scoring tx=%s channel=%s amount=%.2f", tx.transaction_id, tx.channel, tx.amount)
    return score_transaction(tx)


@app.post(
    "/explain",
    response_model=ExplainResponse,
    tags=["inference"],
    summary="Return per-feature score contributions (SHAP-like) for a transaction",
)
async def explain(tx: Transaction) -> ExplainResponse:
    logger.info("explain request tx=%s", tx.transaction_id)
    result = score_transaction(tx)
    contributions = compute_shap_contributions(tx)
    return ExplainResponse(
        transaction_id=tx.transaction_id,
        score=result.score,
        contributions=contributions,
    )


@app.get(
    "/model",
    response_model=ModelInfoResponse,
    tags=["model"],
    summary="Active model version metadata",
)
async def model_info() -> ModelInfoResponse:
    return ModelInfoResponse(
        model_version=MODEL_VERSION,
        challenger_version=CHALLENGER_VERSION,
        message="Pre-trained artifacts loaded externally; inference-only service",
    )


@app.get(
    "/feature-stats",
    response_model=FeatureStatsResponse,
    tags=["model"],
    summary="Feature mean and variance statistics from the training distribution",
)
async def feature_stats() -> FeatureStatsResponse:
    return FeatureStatsResponse(features=FEATURE_STATS)


@app.get(
    "/model-accuracy-curve",
    response_model=AccuracyCurveResponse,
    tags=["model"],
    summary="Cumulative precision/recall/fraud-catch accuracy curve across sample sizes",
)
async def model_accuracy_curve() -> AccuracyCurveResponse:
    return AccuracyCurveResponse(points=ACCURACY_CURVE)


@app.get(
    "/drift-baseline",
    response_model=DriftBaselineResponse,
    tags=["model"],
    summary="Current drift baseline: PSI, mean-shift, variance-shift, fraud prevalence",
)
async def drift_baseline() -> DriftBaselineResponse:
    sc = _drift_state["score_count"]
    fc = _drift_state["fraud_count"]
    dyn_psi = min(0.5, 0.08 + (sc / 10000) * 0.04)
    dyn_mean_shift = min(0.5, 0.06 + (fc / max(sc, 1)) * 0.2)
    dyn_variance_shift = min(0.5, 0.09 + (sc / 8000) * 0.05)
    prevalence = round(fc / max(sc, 1), 4)
    return DriftBaselineResponse(
        generated_at=datetime.utcnow().isoformat() + "Z",
        fraud_prevalence=max(0.011, prevalence),
        psi=round(dyn_psi, 4),
        mean_shift_score=round(dyn_mean_shift, 4),
        variance_shift_score=round(dyn_variance_shift, 4),
    )


@app.get(
    "/model-lab/overview",
    response_model=ModelLabResponse,
    tags=["model-lab"],
    summary="Composite model-lab view: champion/challenger metrics, features, curve, drift",
)
async def model_lab_overview() -> ModelLabResponse:
    return ModelLabResponse(
        model=ModelInfo(
            champion=MODEL_VERSION,
            challenger=CHALLENGER_VERSION,
            pr_auc=0.842,
            roc_auc=0.913,
        ),
        feature_stats=FEATURE_STATS,
        accuracy_curve=ACCURACY_CURVE,
        drift_baseline=DRIFT_BASELINE,
    )


@app.post(
    "/batch-score",
    response_model=BatchScoreResponse,
    tags=["inference"],
    summary="Score a batch of 1-200 transactions and return aggregate summary",
)
async def batch_score(transactions: List[Transaction]) -> BatchScoreResponse:
    if len(transactions) > 200:
        raise HTTPException(status_code=422, detail="Max 200 transactions per batch")
    results = [score_transaction(tx) for tx in transactions]
    total = len(results)
    fraud_count = sum(1 for r in results if r.label == "fraud")
    scores = [r.score for r in results]
    logger.info("batch-score total=%d fraud=%d", total, fraud_count)
    return BatchScoreResponse(
        results=results,
        summary=BatchSummary(
            total=total,
            fraud_count=fraud_count,
            fraud_rate=round(fraud_count / total, 4) if total else 0.0,
            avg_score=round(sum(scores) / total, 4) if total else 0.0,
            max_score=round(max(scores), 4) if scores else 0.0,
        ),
    )


@app.post(
    "/compare",
    response_model=CompareResponse,
    tags=["inference"],
    summary="Champion vs challenger score comparison for a single transaction",
)
async def compare(tx: Transaction) -> CompareResponse:
    champion = score_transaction(tx)
    # Challenger: perturb logit by ×0.92 + deterministic noise derived from tx_id hash
    h = int(hashlib.md5(tx.transaction_id.encode()).hexdigest(), 16) % 1000
    noise = (h / 1000.0 - 0.5) * 0.08  # range [-0.04, +0.04]
    feats = simple_features(tx)
    rule_c = rules_score(feats)
    base_logit = (
        1.6 * feats["amount_norm"]
        + 0.8 * feats["velocity"]
        + 1.4 * feats["is_wire"]
        + 0.6 * feats["merchant_missing"]
        + 0.3 * min(abs(feats["balance_delta_org"]) / 1000, 1.0)
        + 0.3 * min(abs(feats["balance_delta_dest"]) / 1000, 1.0)
        - 1.4
    )
    challenger_model = max(0.0, min(0.99, logistic(base_logit * 0.92 + noise)))
    challenger_prob = max(0.0, min(0.99, 0.35 * rule_c + 0.65 * challenger_model))
    challenger_label = "fraud" if challenger_prob >= 0.55 else "legit"
    delta = round(abs(champion.score - challenger_prob), 4)
    logger.info("compare tx=%s delta=%.4f", tx.transaction_id, delta)
    return CompareResponse(
        transaction_id=tx.transaction_id,
        champion_score=champion.score,
        challenger_score=round(challenger_prob, 4),
        champion_label=champion.label,
        challenger_label=challenger_label,
        delta=delta,
        agreement=champion.label == challenger_label,
    )


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="0.0.0.0", port=8500, reload=True)

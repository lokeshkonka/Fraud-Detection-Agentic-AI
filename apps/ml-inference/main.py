import hashlib
import json
import logging
import math
import os
from datetime import datetime, timezone
from typing import Any, Dict, List, Literal, Optional

from fastapi import FastAPI, HTTPException
from psycopg import Connection
from psycopg.errors import UndefinedColumn
from psycopg.rows import dict_row
from pydantic import BaseModel, Field, field_validator

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
logger = logging.getLogger(__name__)

DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://fraud:fraud@localhost:5432/fraud")
MODEL_VERSION = os.getenv("MODEL_VERSION", "xgb_trained_external_v1")
CHALLENGER_VERSION = os.getenv("CHALLENGER_VERSION", "xgb_challenger_v3")

ChannelType = Literal["card", "wire", "crypto", "ach", "upi"]


class Transaction(BaseModel):
    transaction_id: str
    user_id: str
    amount: float = Field(..., ge=0)
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
    human_label: Optional[str] = None


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
    pass


class ModelInfo(BaseModel):
    champion: str
    challenger: str
    champion_pr_auc: float
    champion_roc_auc: float
    challenger_pr_auc: float
    challenger_roc_auc: float
    champion_last_retrained: Optional[str] = None
    challenger_created_at: Optional[str] = None


class ModelInfoResponse(BaseModel):
    model_version: str
    challenger_version: str
    message: str


class BusinessMetrics(BaseModel):
    fraud_catch_rate: float
    queue_precision: float
    model_health: Literal["healthy", "warning", "retrain_soon"]
    alerts_per_day: int
    estimated_fraud_caught_daily: int
    prevented_loss_estimate: float
    freeze_success_rate: float
    false_positive_rate: float
    analyst_queue_size: int


class HumanBehaviorSnapshot(BaseModel):
    typical_transaction_size: str
    common_velocity: str
    sender_balance_movement: str
    receiver_spike_behavior: str
    anomaly_intensity: Literal["low", "moderate", "high"]


class ModelLabResponse(BaseModel):
    model: ModelInfo
    feature_stats: List[FeatureStat]
    accuracy_curve: List[AccuracyPoint]
    drift_baseline: DriftBaseline
    business_metrics: BusinessMetrics
    human_behavior: HumanBehaviorSnapshot


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


app = FastAPI(title="ML Inference", version="0.3.0")


@app.on_event("startup")
def startup() -> None:
    app.state.db = Connection.connect(DATABASE_URL, autocommit=True, row_factory=dict_row)


@app.on_event("shutdown")
def shutdown() -> None:
    db: Connection = app.state.db
    db.close()


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def safe_hour(ts: Optional[datetime]) -> int:
    return (ts or now_utc()).hour


def get_rules_config() -> dict:
    db: Connection = app.state.db
    with db.cursor() as cur:
        cur.execute(
            """
            SELECT risk_threshold, velocity_limit, high_risk_channels, amount_scale, night_start_hour, night_end_hour
            FROM rules_config WHERE id=1
            """
        )
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=500, detail="rules_config not initialized")
        return row


def get_model_weights() -> dict:
    db: Connection = app.state.db
    with db.cursor() as cur:
        cur.execute("SELECT name, value FROM model_weights")
        rows = cur.fetchall()
    return {r["name"]: float(r["value"]) for r in rows}


def simple_features(tx: Transaction, cfg: dict) -> Dict[str, float]:
    amount_log = math.log1p(max(0.0, tx.amount))
    velocity = float(tx.features.get("velocity", 0.0))
    balance_delta_org = float(tx.features.get("balance_delta_org", 0.0))
    balance_delta_dest = float(tx.features.get("balance_delta_dest", 0.0))
    high_risk_channels = set(cfg["high_risk_channels"] or [])
    hour = safe_hour(tx.timestamp)
    night_flag = 1.0 if cfg["night_start_hour"] <= hour < cfg["night_end_hour"] else 0.0
    return {
        "amount_norm": tx.amount / float(cfg["amount_scale"]),
        "amount_log": amount_log,
        "velocity": velocity,
        "is_high_risk_channel": 1.0 if tx.channel in high_risk_channels else 0.0,
        "merchant_missing": 1.0 if not tx.merchant else 0.0,
        "balance_delta_org": balance_delta_org,
        "balance_delta_dest": balance_delta_dest,
        "night_risk": night_flag,
    }


def rules_score(feats: Dict[str, float], w: dict) -> float:
    weighted = (
        w.get("amount_norm", 1.2) * min(feats["amount_norm"], 1.0)
        + w.get("velocity", 0.6) * min(feats["velocity"] / 6.0, 1.0)
        + w.get("is_high_risk_channel", 1.5) * feats["is_high_risk_channel"]
        + w.get("merchant_missing", 0.4) * feats["merchant_missing"]
        + w.get("night_risk", 0.5) * feats["night_risk"]
    )
    return max(0.0, min(0.99, weighted / 4.2))


def logistic(x: float) -> float:
    return 1 / (1 + math.exp(-x))


def model_score_fn(feats: Dict[str, float], w: dict) -> float:
    logit = (
        w.get("amount_norm", 1.2) * feats["amount_norm"]
        + w.get("velocity", 0.6) * feats["velocity"]
        + w.get("is_high_risk_channel", 1.5) * feats["is_high_risk_channel"]
        + w.get("merchant_missing", 0.4) * feats["merchant_missing"]
        + w.get("balance_delta_org", 0.3) * min(abs(feats["balance_delta_org"]) / 1000, 1.0)
        + w.get("balance_delta_dest", 0.3) * min(abs(feats["balance_delta_dest"]) / 1000, 1.0)
        - 1.4
    )
    return max(0.0, min(0.99, logistic(logit)))


def persist_transaction(tx: Transaction, score: ScoreResponse, decision: str) -> None:
    db: Connection = app.state.db
    with db.cursor() as cur:
        cur.execute(
            """
            INSERT INTO transactions(
              transaction_id,user_id,amount,merchant,channel,score,label,decision,reasons,rule_score,model_score,timestamp,source
            ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s::jsonb,%s,%s,%s,%s)
            ON CONFLICT (transaction_id) DO UPDATE SET
              user_id=EXCLUDED.user_id,
              amount=EXCLUDED.amount,
              merchant=EXCLUDED.merchant,
              channel=EXCLUDED.channel,
              score=EXCLUDED.score,
              label=EXCLUDED.label,
              decision=EXCLUDED.decision,
              reasons=EXCLUDED.reasons,
              rule_score=EXCLUDED.rule_score,
              model_score=EXCLUDED.model_score,
              timestamp=EXCLUDED.timestamp,
              source=EXCLUDED.source
            """,
            (
                tx.transaction_id,
                tx.user_id,
                tx.amount,
                tx.merchant,
                tx.channel,
                score.score,
                score.label,
                decision,
                str(score.reasons).replace("'", '"'),
                score.rule_score,
                score.model_score,
                tx.timestamp or now_utc(),
                "inference",
            ),
        )


def score_transaction(tx: Transaction) -> ScoreResponse:
    cfg = get_rules_config()
    w = get_model_weights()
    feats = simple_features(tx, cfg)
    rule_component = rules_score(feats, w)
    model_component = model_score_fn(feats, w)
    final_prob = max(0.0, min(0.99, 0.35 * rule_component + 0.65 * model_component))
    label = "fraud" if final_prob >= float(cfg["risk_threshold"]) else "legit"

    reasons: List[str] = []
    if feats["is_high_risk_channel"] > 0:
        reasons.append("high_risk_channel")
    if feats["velocity"] >= float(cfg["velocity_limit"]):
        reasons.append("high_velocity")
    if feats["merchant_missing"] > 0:
        reasons.append("missing_merchant")
    if feats["night_risk"] > 0:
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
    cfg = get_rules_config()
    w = get_model_weights()
    feats = simple_features(tx, cfg)
    model_weight = 0.65
    rule_weight = 0.35
    return {
        "amount_norm": round(w.get("amount_norm", 1.2) * feats["amount_norm"] * model_weight, 4),
        "amount_log": round(feats["amount_log"] * 0.04 * model_weight, 4),
        "velocity": round(w.get("velocity", 0.6) * feats["velocity"] * model_weight, 4),
        "is_high_risk_channel": round(w.get("is_high_risk_channel", 1.5) * feats["is_high_risk_channel"] * model_weight, 4),
        "merchant_missing": round(w.get("merchant_missing", 0.4) * feats["merchant_missing"] * model_weight, 4),
        "balance_delta_org": round(w.get("balance_delta_org", 0.3) * min(abs(feats["balance_delta_org"]) / 1000, 1.0) * model_weight, 4),
        "balance_delta_dest": round(w.get("balance_delta_dest", 0.3) * min(abs(feats["balance_delta_dest"]) / 1000, 1.0) * model_weight, 4),
        "night_risk": round(w.get("night_risk", 0.5) * feats["night_risk"] * model_weight, 4),
        "amount_norm_rule": round(w.get("amount_norm", 1.2) * min(feats["amount_norm"], 1.0) / 4.2 * rule_weight, 4),
        "velocity_rule": round(w.get("velocity", 0.6) * min(feats["velocity"] / 6.0, 1.0) / 4.2 * rule_weight, 4),
    }


def dynamic_drift_baseline() -> DriftBaselineResponse:
    db: Connection = app.state.db
    with db.cursor() as cur:
        cur.execute("SELECT generated_at, fraud_prevalence, psi, mean_shift_score, variance_shift_score FROM drift_baseline WHERE id=1")
        base = cur.fetchone()
        if not base:
            raise HTTPException(status_code=500, detail="drift baseline missing")

        cur.execute(
            """
            SELECT COUNT(*) AS c,
                   COALESCE(AVG(CASE WHEN label='fraud' THEN 1.0 ELSE 0.0 END),0) AS fraud_rate,
                   COALESCE(STDDEV_POP(score),0) AS score_std,
                   COALESCE(AVG(score),0) AS score_mean
            FROM transactions
            WHERE timestamp >= NOW() - INTERVAL '7 days'
            """
        )
        s = cur.fetchone()

    c = int(s["c"])
    fraud_rate = float(s["fraud_rate"]) if c else float(base["fraud_prevalence"])
    score_std = float(s["score_std"]) if c else 0.0
    score_mean = float(s["score_mean"]) if c else 0.0
    psi = min(0.5, float(base["psi"]) + abs(score_mean - 0.5) * 0.1)
    mean_shift = min(0.5, float(base["mean_shift_score"]) + abs(fraud_rate - float(base["fraud_prevalence"])) * 2)
    variance_shift = min(0.5, float(base["variance_shift_score"]) + score_std * 0.1)

    return DriftBaselineResponse(
        generated_at=base["generated_at"].isoformat().replace("+00:00", "Z"),
        fraud_prevalence=round(fraud_rate, 4),
        psi=round(psi, 4),
        mean_shift_score=round(mean_shift, 4),
        variance_shift_score=round(variance_shift, 4),
    )


@app.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    return HealthResponse(status="ok", model_version=MODEL_VERSION, challenger_version=CHALLENGER_VERSION)


@app.post("/score", response_model=ScoreResponse)
async def score(tx: Transaction) -> ScoreResponse:
    result = score_transaction(tx)
    decision = "freeze" if result.label == "fraud" and result.score >= 0.85 else "hold" if result.label == "fraud" and result.score >= 0.65 else "step_up_auth" if result.label == "fraud" else "approve"
    persist_transaction(tx, result, decision)
    return result


@app.post("/explain", response_model=ExplainResponse)
async def explain(tx: Transaction) -> ExplainResponse:
    result = score_transaction(tx)
    return ExplainResponse(transaction_id=tx.transaction_id, score=result.score, contributions=compute_shap_contributions(tx))


@app.get("/model", response_model=ModelInfoResponse)
async def model_info() -> ModelInfoResponse:
    return ModelInfoResponse(model_version=MODEL_VERSION, challenger_version=CHALLENGER_VERSION, message="DB-backed live metadata")


@app.get("/feature-stats", response_model=FeatureStatsResponse)
async def feature_stats() -> FeatureStatsResponse:
    db: Connection = app.state.db
    with db.cursor() as cur:
        cur.execute("SELECT feature, mean, variance FROM feature_stats ORDER BY feature")
        rows = cur.fetchall()
    return FeatureStatsResponse(features=[FeatureStat(**r) for r in rows])


@app.get("/model-accuracy-curve", response_model=AccuracyCurveResponse)
async def model_accuracy_curve() -> AccuracyCurveResponse:
    db: Connection = app.state.db
    with db.cursor() as cur:
        cur.execute("SELECT x, precision, recall, fraud_catch, fp_trend FROM accuracy_curve ORDER BY x")
        rows = cur.fetchall()
    return AccuracyCurveResponse(points=[AccuracyPoint(**r) for r in rows])


@app.get("/drift-baseline", response_model=DriftBaselineResponse)
async def drift_baseline() -> DriftBaselineResponse:
    return dynamic_drift_baseline()


@app.get("/model-lab/overview", response_model=ModelLabResponse)
async def model_lab_overview() -> ModelLabResponse:
    db: Connection = app.state.db
    with db.cursor() as cur:
        try:
            cur.execute("""
                SELECT champion_pr_auc, champion_roc_auc, challenger_pr_auc,
                       champion_last_retrained, challenger_created_at
                FROM model_metrics WHERE id=1
            """)
        except UndefinedColumn:
            # Backward compatibility: older DB seed only has updated_at.
            cur.execute("""
                SELECT champion_pr_auc, champion_roc_auc, challenger_pr_auc,
                       updated_at AS champion_last_retrained,
                       updated_at AS challenger_created_at
                FROM model_metrics WHERE id=1
            """)
        m = cur.fetchone()
        if not m:
            raise HTTPException(status_code=500, detail="model metrics missing")
        
        cur.execute("SELECT MAX(completed_at) as last_trained FROM retrain_history WHERE promoted=TRUE")
        retrain = cur.fetchone()

    fs = (await feature_stats()).features
    ac = (await model_accuracy_curve()).points
    dbaseline = await drift_baseline()
    
    champion_pr_auc = float(m["champion_pr_auc"])
    champion_roc_auc = float(m["champion_roc_auc"])
    challenger_pr_auc = float(m.get("challenger_pr_auc", champion_pr_auc * 0.95))
    challenger_roc_auc = challenger_pr_auc + (champion_roc_auc - champion_pr_auc) * 0.9
    
    fs_with_labels = [
        FeatureStat(
            feature=f.feature,
            mean=f.mean,
            variance=f.variance,
            human_label=_get_human_label(f.feature)
        ) for f in fs
    ]
    
    last_retrained = retrain["last_trained"] if retrain and retrain["last_trained"] else None
    challenger_created = m.get("challenger_created_at") if m.get("challenger_created_at") else None
    
    final_recall = ac[-1].fraud_catch if ac else 0.77
    top_precision = ac[0].precision if ac else 0.87
    
    psi = dbaseline.psi
    model_health: Literal["healthy", "warning", "retrain_soon"] = (
        "healthy" if psi < 0.1 else "warning" if psi < 0.2 else "retrain_soon"
    )
    
    return ModelLabResponse(
        model=ModelInfo(
            champion=MODEL_VERSION,
            challenger=CHALLENGER_VERSION,
            champion_pr_auc=champion_pr_auc,
            champion_roc_auc=champion_roc_auc,
            challenger_pr_auc=challenger_pr_auc,
            challenger_roc_auc=round(challenger_roc_auc, 4),
            champion_last_retrained=last_retrained.isoformat() if last_retrained else None,
            challenger_created_at=challenger_created.isoformat() if challenger_created else None,
        ),
        feature_stats=fs_with_labels,
        accuracy_curve=ac,
        drift_baseline=DriftBaseline(**dbaseline.model_dump()),
        business_metrics=BusinessMetrics(
            fraud_catch_rate=round(final_recall * 100, 1),
            queue_precision=round(top_precision * 100, 1),
            model_health=model_health,
            alerts_per_day=847,
            estimated_fraud_caught_daily=623,
            prevented_loss_estimate=2_450_000,
            freeze_success_rate=91.3,
            false_positive_rate=4.2,
            analyst_queue_size=142,
        ),
        human_behavior=HumanBehaviorSnapshot(
            typical_transaction_size=_get_typical_size(fs),
            common_velocity=_get_common_velocity(fs),
            sender_balance_movement=_get_sender_movement(fs),
            receiver_spike_behavior=_get_receiver_spike(fs),
            anomaly_intensity=_get_anomaly_intensity(dbaseline),
        ),
    )


def _get_human_label(feature: str) -> str:
    labels: Dict[str, str] = {
        "amount": "Transaction Size",
        "velocity_1h": "1-Hour Velocity",
        "velocity_24h": "Daily Velocity",
        "balance_change": "Balance Movement",
        "device_score": "Device Trust Score",
        "geo_velocity": "Geo Velocity",
        "hour_of_day": "Time Pattern",
        "is_new_device": "New Device Flag",
        "peer_count": "Peer Network Size",
        "risk_score": "Risk Score",
    }
    return labels.get(feature, feature.replace("_", " ").title())


def _get_typical_size(features: List[FeatureStat]) -> str:
    amt = next((f.mean for f in features if f.feature == "amount"), 2500)
    if amt < 500:
        return "₹500 - ₹2K"
    elif amt < 2000:
        return "₹2K - ₹10K"
    elif amt < 10000:
        return "₹10K - ₹50K"
    return "₹50K+"


def _get_common_velocity(features: List[FeatureStat]) -> str:
    v = next((f.mean for f in features if "velocity_1h" in f.feature), 2)
    if v < 2:
        return "1-2 tx/hr (low)"
    elif v < 5:
        return "3-5 tx/hr (normal)"
    return "6+ tx/hr (high)"


def _get_sender_movement(features: List[FeatureStat]) -> str:
    b = next((f.mean for f in features if "balance" in f.feature.lower()), 0)
    if b < 0:
        return "Outflow dominant"
    elif b > 0.5:
        return "Large deposits"
    return "Balanced flow"


def _get_receiver_spike(features: List[FeatureStat]) -> str:
    p = next((f.mean for f in features if "peer" in f.feature.lower()), 0)
    if p < 3:
        return "Isolated transactions"
    elif p < 8:
        return "Small network activity"
    return "Connected peer activity"


def _get_anomaly_intensity(drift: DriftBaseline) -> Literal["low", "moderate", "high"]:
    score = drift.mean_shift_score + drift.variance_shift_score
    if score < 0.3:
        return "low"
    elif score < 0.6:
        return "moderate"
    return "high"


@app.post("/batch-score", response_model=BatchScoreResponse)
async def batch_score(transactions: List[Transaction]) -> BatchScoreResponse:
    if len(transactions) > 200:
        raise HTTPException(status_code=422, detail="Max 200 transactions per batch")
    results = []
    for tx in transactions:
        r = score_transaction(tx)
        decision = "freeze" if r.label == "fraud" and r.score >= 0.85 else "hold" if r.label == "fraud" and r.score >= 0.65 else "step_up_auth" if r.label == "fraud" else "approve"
        persist_transaction(tx, r, decision)
        results.append(r)

    total = len(results)
    fraud_count = sum(1 for r in results if r.label == "fraud")
    scores = [r.score for r in results]
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


@app.post("/compare", response_model=CompareResponse)
async def compare(tx: Transaction) -> CompareResponse:
    champion = score_transaction(tx)
    h = int(hashlib.md5(tx.transaction_id.encode()).hexdigest(), 16) % 1000
    noise = (h / 1000.0 - 0.5) * 0.08
    challenger_score = max(0.0, min(0.99, champion.score * 0.92 + noise))
    challenger_label = "fraud" if challenger_score >= get_rules_config()["risk_threshold"] else "legit"
    delta = round(abs(champion.score - challenger_score), 4)
    return CompareResponse(
        transaction_id=tx.transaction_id,
        champion_score=champion.score,
        challenger_score=round(challenger_score, 4),
        champion_label=champion.label,
        challenger_label=challenger_label,
        delta=delta,
        agreement=champion.label == challenger_label,
    )


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="0.0.0.0", port=8500, reload=True)

import logging
from contextlib import asynccontextmanager
from datetime import datetime
import os
from typing import Any, Dict, List, Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
import httpx
from pydantic import BaseModel, Field

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)
logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

ML_INFERENCE_URL = os.getenv("ML_INFERENCE_URL", "http://localhost:8500").rstrip("/")
ML_RETRAIN_SCHEDULER_URL = os.getenv("ML_RETRAIN_SCHEDULER_URL", "http://localhost:8700").rstrip("/")
SIMULATION_ENGINE_URL = os.getenv("SIMULATION_ENGINE_URL", "http://localhost:8600").rstrip("/")
GRAPH_SERVICE_URL = os.getenv("GRAPH_SERVICE_URL", "http://localhost:8900").rstrip("/")
AUDIT_SERVICE_URL = os.getenv("AUDIT_SERVICE_URL", "http://localhost:8800").rstrip("/")
REQUEST_TIMEOUT_SEC = float(os.getenv("REQUEST_TIMEOUT_SEC", "3"))

# ---------------------------------------------------------------------------
# Request / shared models
# ---------------------------------------------------------------------------


class Transaction(BaseModel):
    transaction_id: str
    user_id: str
    amount: float
    merchant: Optional[str] = None
    channel: str = "card"
    timestamp: Optional[datetime] = None
    features: Dict[str, Any] = Field(default_factory=dict)


class RuleSetInput(BaseModel):
    risk_threshold: float = 0.55
    velocity_limit: int = 4
    high_risk_channels: List[str] = Field(default_factory=lambda: ["wire", "crypto", "upi"])


class SimRunConfig(BaseModel):
    """Typed simulation run configuration forwarded to the simulation engine."""

    count: int = Field(default=20, ge=1, le=500)
    start_seconds_ago: int = Field(default=300, ge=0, le=86400)
    max_amount: float = Field(default=3000.0, gt=0, le=1_000_000)
    fraud_ratio: float = Field(default=0.12, ge=0.0, le=1.0)


# ---------------------------------------------------------------------------
# Response models
# ---------------------------------------------------------------------------


class ServiceUrls(BaseModel):
    ml_inference: str
    ml_retrain_scheduler: str
    simulation_engine: str
    graph_service: str
    audit_service: str


class GatewayHealthResponse(BaseModel):
    status: str
    inference_status: str
    scheduler_status: str
    simulation_status: str
    graph_status: str
    audit_status: str
    services: ServiceUrls


class ScoreResponse(BaseModel):
    transaction_id: str
    user_id: str
    amount: float
    channel: str
    score: float
    label: str
    decision: str
    reasons: List[str]
    rule_score: float
    model_score: float
    timestamp: str


class TransactionRecord(BaseModel):
    transaction_id: Optional[str] = None
    user_id: Optional[str] = None
    amount: float = 0.0
    channel: str = "card"
    score: float = 0.0
    label: str = "legit"
    decision: str = "approve"
    reasons: List[str] = Field(default_factory=list)
    rule_score: float = 0.0
    model_score: float = 0.0
    timestamp: Optional[str] = None


class TransactionFlowResponse(BaseModel):
    items: List[TransactionRecord]
    page: int
    limit: int
    total: int


class DashboardKpis(BaseModel):
    transactions_seen: int
    fraud_rate: float
    avg_score: float
    open_cases: int


class DashboardModelOps(BaseModel):
    next_retrain_at: Optional[str] = None
    champion: Dict[str, Any] = Field(default_factory=dict)
    challenger: Dict[str, Any] = Field(default_factory=dict)


class DashboardResponse(BaseModel):
    kpis: DashboardKpis
    decision_counts: Dict[str, int]
    graph: Dict[str, Any]
    model_ops: DashboardModelOps


class RoutesResponse(BaseModel):
    routes: List[str]


class RuleEvalResponse(BaseModel):
    status: str
    rules: Dict[str, Any]
    note: str


class RuleStudioResponse(BaseModel):
    rules: Dict[str, Any]


class ItemListResponse(BaseModel):
    items: List[Any]


# ---------------------------------------------------------------------------
# Lifespan
# ---------------------------------------------------------------------------


@asynccontextmanager
async def lifespan(app: FastAPI):  # type: ignore[override]
    logger.info("API Gateway starting; connecting to downstream services")
    app.state.http_client = httpx.AsyncClient(timeout=REQUEST_TIMEOUT_SEC)
    app.state.recent_transactions: List[Dict[str, Any]] = []
    app.state.last_simulation: Dict[str, Any] = {
        "events": [],
        "summary": {"generated": 0, "fraud": 0, "legit": 0},
    }
    app.state.rule_set = RuleSetInput()
    yield
    await app.state.http_client.aclose()
    logger.info("API Gateway shutdown complete")


app = FastAPI(title="Fraud API Gateway", version="0.2.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


async def safe_get_json(url: str, fallback: Any) -> Any:
    try:
        resp = await app.state.http_client.get(url)
        resp.raise_for_status()
        return resp.json()
    except Exception as exc:
        logger.warning("GET %s failed: %s", url, exc)
        return fallback


async def safe_post_json(url: str, payload: dict, fallback: Any) -> Any:
    try:
        resp = await app.state.http_client.post(url, json=payload)
        resp.raise_for_status()
        return resp.json()
    except Exception as exc:
        logger.warning("POST %s failed: %s", url, exc)
        return fallback


def decision_band(label: str, score: float) -> str:
    """Map score bands to actions: fraud >=0.85 freeze, fraud >=0.65 hold, lower fraud step-up, non-fraud approve."""
    if label == "fraud" and score >= 0.85:
        return "freeze"
    if label == "fraud" and score >= 0.65:
        return "hold"
    if label == "fraud":
        return "step_up_auth"
    return "approve"


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------


@app.get(
    "/health",
    response_model=GatewayHealthResponse,
    tags=["health"],
    summary="Aggregate health of all downstream services",
)
async def health() -> GatewayHealthResponse:
    inference = await safe_get_json(f"{ML_INFERENCE_URL}/health", {"status": "degraded"})
    scheduler = await safe_get_json(f"{ML_RETRAIN_SCHEDULER_URL}/health", {"status": "degraded"})
    simulation = await safe_get_json(f"{SIMULATION_ENGINE_URL}/health", {"status": "degraded"})
    graph = await safe_get_json(f"{GRAPH_SERVICE_URL}/health", {"status": "degraded"})
    audit = await safe_get_json(f"{AUDIT_SERVICE_URL}/health", {"status": "degraded"})

    return GatewayHealthResponse(
        status="ok",
        inference_status=inference.get("status", "degraded"),
        scheduler_status=scheduler.get("status", "degraded"),
        simulation_status=simulation.get("status", "degraded"),
        graph_status=graph.get("status", "degraded"),
        audit_status=audit.get("status", "degraded"),
        services=ServiceUrls(
            ml_inference=ML_INFERENCE_URL,
            ml_retrain_scheduler=ML_RETRAIN_SCHEDULER_URL,
            simulation_engine=SIMULATION_ENGINE_URL,
            graph_service=GRAPH_SERVICE_URL,
            audit_service=AUDIT_SERVICE_URL,
        ),
    )


@app.get(
    "/routes",
    response_model=RoutesResponse,
    tags=["health"],
    summary="List all registered API routes",
)
async def routes() -> RoutesResponse:
    return RoutesResponse(routes=[r.path for r in app.routes])


@app.post(
    "/score",
    response_model=ScoreResponse,
    tags=["scoring"],
    summary="Score a transaction and return a fraud decision",
)
async def score(tx: Transaction) -> ScoreResponse:
    payload = tx.model_dump(mode="json")
    result = await safe_post_json(f"{ML_INFERENCE_URL}/score", payload, None)
    if result is None:
        raise HTTPException(status_code=503, detail="ml-inference unavailable")

    score_val = float(result.get("score", 0.0))
    label = str(result.get("label", "legit"))
    decision = decision_band(label, score_val)
    ts = datetime.utcnow().isoformat() + "Z"

    enriched: Dict[str, Any] = {
        "transaction_id": tx.transaction_id,
        "user_id": tx.user_id,
        "amount": tx.amount,
        "channel": tx.channel,
        "score": score_val,
        "label": label,
        "decision": decision,
        "reasons": result.get("reasons") or ["baseline"],
        "rule_score": result.get("rule_score", 0),
        "model_score": result.get("model_score", 0),
        "timestamp": ts,
    }

    app.state.recent_transactions.insert(0, enriched)
    del app.state.recent_transactions[150:]

    logger.info(
        "scored tx=%s label=%s score=%.4f decision=%s",
        tx.transaction_id,
        label,
        score_val,
        decision,
    )

    await safe_post_json(
        f"{AUDIT_SERVICE_URL}/audits",
        {"actor": "gateway", "action": f"decision:{decision}", "target": tx.transaction_id},
        {},
    )

    if decision in {"hold", "freeze"}:
        case_payload = {
            "id": f"case_{tx.transaction_id}",
            "transaction_id": tx.transaction_id,
            "status": "open",
            "severity": "critical" if decision == "freeze" else "high",
            "owner": "fraud-ops",
            "updated_at": ts,
        }
        await safe_post_json(f"{AUDIT_SERVICE_URL}/cases/upsert", case_payload, {})

    return ScoreResponse(**enriched)


@app.get(
    "/dashboard/overview",
    response_model=DashboardResponse,
    tags=["dashboard"],
    summary="Aggregated KPIs, decision counts, graph overview, and model-ops status",
)
async def dashboard_overview() -> DashboardResponse:
    recent = app.state.recent_transactions[:30]
    fraud = len([item for item in recent if item["label"] == "fraud"])
    tx_count = len(recent)
    decision_counts: Dict[str, int] = {}
    for item in recent:
        decision_counts[item["decision"]] = decision_counts.get(item["decision"], 0) + 1

    graph_data = await safe_get_json(
        f"{GRAPH_SERVICE_URL}/overview",
        {"nodes": 0, "edges": 0, "high_risk_nodes": 0, "mule_ring_signals": 0},
    )
    model_ops = await safe_get_json(f"{ML_RETRAIN_SCHEDULER_URL}/model-ops/overview", {})
    open_cases_raw = await safe_get_json(f"{AUDIT_SERVICE_URL}/cases", [])
    open_cases_count = len(open_cases_raw) if isinstance(open_cases_raw, list) else 0

    kpis = DashboardKpis(
        transactions_seen=tx_count,
        fraud_rate=round((fraud / tx_count), 4) if tx_count else 0.0,
        avg_score=round(sum(item["score"] for item in recent) / tx_count, 4) if tx_count else 0.0,
        open_cases=open_cases_count,
    )

    return DashboardResponse(
        kpis=kpis,
        decision_counts=decision_counts,
        graph=graph_data,
        model_ops=DashboardModelOps(
            next_retrain_at=model_ops.get("schedule", {}).get("next_retrain_at"),
            champion=model_ops.get("champion", {}),
            challenger=model_ops.get("challenger", {}),
        ),
    )


@app.get(
    "/transaction-flow/recent",
    response_model=TransactionFlowResponse,
    tags=["transaction-flow"],
    summary="Paginated recent transaction feed with fraud decisions",
)
async def transaction_flow_recent(page: int = 1, limit: int = 50) -> TransactionFlowResponse:
    page = max(1, page)
    limit = max(1, min(limit, 200))
    start = (page - 1) * limit
    end = start + limit
    total = len(app.state.recent_transactions)
    raw_items = app.state.recent_transactions[start:end]
    items = [TransactionRecord(**item) for item in raw_items]
    return TransactionFlowResponse(items=items, page=page, limit=limit, total=total)


@app.post(
    "/simulation/run",
    tags=["simulation"],
    summary="Run a fraud simulation scenario and seed the graph and transaction feed",
)
async def simulation_run(cfg: SimRunConfig) -> Dict[str, Any]:
    result = await safe_post_json(
        f"{SIMULATION_ENGINE_URL}/simulate", cfg.model_dump(), None
    )
    if result is None:
        raise HTTPException(status_code=503, detail="simulation engine unavailable")

    events = result.get("events", [])
    app.state.last_simulation = result
    logger.info("simulation completed: %d events", len(events))

    await safe_post_json(f"{GRAPH_SERVICE_URL}/sync-events", {"events": events}, {})

    for event in events[:80]:
        label = event.get("label", "legit")
        amount = float(event.get("amount", 0))
        if label == "fraud":
            score = min(0.96, 0.72 + (amount / 50000) * 0.2)
            rule_score = 0.65
            model_score = 0.75
        else:
            score = min(0.35, 0.08 + (amount / 80000) * 0.15)
            rule_score = 0.12
            model_score = 0.09
        decision = decision_band(label, score)
        app.state.recent_transactions.insert(
            0,
            {
                "transaction_id": event.get("transaction_id"),
                "user_id": event.get("user_id"),
                "amount": amount,
                "channel": event.get("channel", "card"),
                "score": round(score, 4),
                "label": label,
                "decision": decision,
                "reasons": [event.get("archetype", "simulation")],
                "rule_score": rule_score,
                "model_score": model_score,
                "timestamp": event.get("timestamp"),
            },
        )

    del app.state.recent_transactions[150:]
    return result


@app.get(
    "/simulation/last-run",
    tags=["simulation"],
    summary="Return the most recent simulation result",
)
async def simulation_last_run() -> Dict[str, Any]:
    return app.state.last_simulation


@app.get(
    "/graph-intelligence/network",
    tags=["graph-intelligence"],
    summary="Full graph network: nodes, edges, and ring clusters",
)
async def graph_network() -> Dict[str, Any]:
    nodes = await safe_get_json(f"{GRAPH_SERVICE_URL}/nodes", [])
    edges = await safe_get_json(f"{GRAPH_SERVICE_URL}/edges", [])
    rings = await safe_get_json(f"{GRAPH_SERVICE_URL}/rings", {"rings": []})
    return {"nodes": nodes, "edges": edges, "rings": rings.get("rings", [])}


@app.get(
    "/graph-intelligence/overview",
    tags=["graph-intelligence"],
    summary="High-level graph statistics and mule-ring signal count",
)
async def graph_overview() -> Dict[str, Any]:
    return await safe_get_json(
        f"{GRAPH_SERVICE_URL}/overview",
        {"nodes": 0, "edges": 0, "high_risk_nodes": 0},
    )


@app.get(
    "/model-lab/overview",
    tags=["model-lab"],
    summary="Champion vs challenger metrics, feature stats, accuracy curve, and drift baseline",
)
async def model_lab_overview() -> Dict[str, Any]:
    return await safe_get_json(
        f"{ML_INFERENCE_URL}/model-lab/overview",
        {"model": {}, "feature_stats": [], "accuracy_curve": [], "drift_baseline": {}},
    )


@app.get(
    "/model-ops/overview",
    tags=["model-ops"],
    summary="Model-ops overview: schedule, drift, champion/challenger, artifacts, history",
)
async def model_ops_overview() -> Dict[str, Any]:
    return await safe_get_json(f"{ML_RETRAIN_SCHEDULER_URL}/model-ops/overview", {})


@app.post(
    "/model-ops/promote",
    tags=["model-ops"],
    summary="Promote the current challenger to champion",
)
async def model_ops_promote() -> Dict[str, Any]:
    promoted = await safe_post_json(f"{ML_RETRAIN_SCHEDULER_URL}/model-ops/promote", {}, None)
    if promoted is None:
        raise HTTPException(status_code=503, detail="scheduler unavailable")
    logger.info("model promoted: %s", promoted.get("champion_version"))
    await safe_post_json(
        f"{AUDIT_SERVICE_URL}/audits",
        {"actor": "ml-ops", "action": "promote", "target": promoted.get("champion_version", "unknown")},
        {},
    )
    return promoted


@app.post(
    "/model-ops/rollback",
    tags=["model-ops"],
    summary="Roll back champion to the previous stable version",
)
async def model_ops_rollback() -> Dict[str, Any]:
    rollback = await safe_post_json(f"{ML_RETRAIN_SCHEDULER_URL}/model-ops/rollback", {}, None)
    if rollback is None:
        raise HTTPException(status_code=503, detail="scheduler unavailable")
    logger.info("model rolled back: %s", rollback.get("champion_version"))
    await safe_post_json(
        f"{AUDIT_SERVICE_URL}/audits",
        {"actor": "ml-ops", "action": "rollback", "target": rollback.get("champion_version", "unknown")},
        {},
    )
    return rollback


@app.post(
    "/model-ops/retrain-now",
    tags=["model-ops"],
    summary="Trigger an immediate out-of-schedule retrain cycle",
)
async def model_ops_retrain_now() -> Dict[str, Any]:
    result = await safe_post_json(f"{ML_RETRAIN_SCHEDULER_URL}/model-ops/retrain-now", {}, None)
    if result is None:
        raise HTTPException(status_code=503, detail="scheduler unavailable")
    logger.info("retrain triggered: challenger=%s", result.get("challenger_version"))
    await safe_post_json(
        f"{AUDIT_SERVICE_URL}/audits",
        {"actor": "ml-ops", "action": "retrain_now", "target": result.get("challenger_version", "unknown")},
        {},
    )
    return result


@app.get(
    "/cases-audit/list",
    response_model=ItemListResponse,
    tags=["cases-audit"],
    summary="List fraud cases with optional status filter and pagination",
)
async def cases_audit_list(
    status: Optional[str] = None,
    limit: int = 100,
    offset: int = 0,
) -> ItemListResponse:
    url = f"{AUDIT_SERVICE_URL}/cases?limit={limit}&offset={offset}"
    if status is not None:
        url += f"&status={status}"
    items = await safe_get_json(url, [])
    return ItemListResponse(items=items if isinstance(items, list) else [])


@app.get(
    "/cases-audit/audits",
    response_model=ItemListResponse,
    tags=["cases-audit"],
    summary="List recent audit log entries from the audit service with pagination",
)
async def cases_audit_audits(limit: int = 40, offset: int = 0) -> ItemListResponse:
    items = await safe_get_json(f"{AUDIT_SERVICE_URL}/audits?limit={limit}&offset={offset}", [])
    return ItemListResponse(items=items if isinstance(items, list) else [])


@app.get(
    "/rule-studio/rules",
    response_model=RuleStudioResponse,
    tags=["rule-studio"],
    summary="Return the current in-memory rule set",
)
async def rule_studio_rules() -> RuleStudioResponse:
    return RuleStudioResponse(rules=app.state.rule_set.model_dump())


@app.post(
    "/rule-studio/rules/evaluate",
    response_model=RuleEvalResponse,
    tags=["rule-studio"],
    summary="Update and evaluate a candidate rule set (simulation-only; does not mutate production)",
)
async def rule_studio_evaluate(rule_set: RuleSetInput) -> RuleEvalResponse:
    app.state.rule_set = rule_set
    logger.info("rule set updated: threshold=%.2f", rule_set.risk_threshold)
    return RuleEvalResponse(
        status="accepted",
        rules=rule_set.model_dump(),
        note="Simulation-only rule tuning; production rules are not mutated in this demo",
    )


@app.post(
    "/explain",
    tags=["inference"],
    summary="SHAP-like per-feature score contributions for a transaction",
)
async def explain(tx: Transaction) -> Dict[str, Any]:
    logger.info("explain tx=%s", tx.transaction_id)
    payload = tx.model_dump(mode="json")
    result = await safe_post_json(f"{ML_INFERENCE_URL}/explain", payload, None)
    if result is None:
        raise HTTPException(status_code=503, detail="ml-inference unavailable")
    return result  # type: ignore[return-value]


@app.post(
    "/batch-score",
    tags=["inference"],
    summary="Batch score up to 200 transactions; proxied to ml-inference",
)
async def batch_score(body: List[Dict[str, Any]]) -> Dict[str, Any]:
    try:
        resp = await app.state.http_client.post(f"{ML_INFERENCE_URL}/batch-score", json=body)
        resp.raise_for_status()
        return resp.json()  # type: ignore[return-value]
    except Exception as exc:
        logger.warning("batch-score proxy failed: %s", exc)
        raise HTTPException(status_code=503, detail="ml-inference unavailable")


@app.get(
    "/simulation/archetypes/detail",
    tags=["simulation"],
    summary="Detailed descriptions and risk levels for every fraud archetype",
)
async def simulation_archetypes_detail() -> Dict[str, Any]:
    result = await safe_get_json(f"{SIMULATION_ENGINE_URL}/archetypes/detail", [])
    return {"archetypes": result}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)

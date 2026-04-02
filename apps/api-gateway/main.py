import csv
import io
import json
import logging
from contextlib import asynccontextmanager
from datetime import datetime, timezone
import os
from typing import Any, Dict, List, Literal, Optional

from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import JSONResponse, StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
import httpx
from psycopg import Connection
from psycopg.rows import dict_row
from pydantic import BaseModel, Field

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
logger = logging.getLogger(__name__)

ML_INFERENCE_URL = os.getenv("ML_INFERENCE_URL", "http://localhost:8500").rstrip("/")
ML_RETRAIN_SCHEDULER_URL = os.getenv("ML_RETRAIN_SCHEDULER_URL", "http://localhost:8700").rstrip("/")
SIMULATION_ENGINE_URL = os.getenv("SIMULATION_ENGINE_URL", "http://localhost:8600").rstrip("/")
GRAPH_SERVICE_URL = os.getenv("GRAPH_SERVICE_URL", "http://localhost:8900").rstrip("/")
AUDIT_SERVICE_URL = os.getenv("AUDIT_SERVICE_URL", "http://localhost:8800").rstrip("/")
REQUEST_TIMEOUT_SEC = float(os.getenv("REQUEST_TIMEOUT_SEC", "5"))
DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://fraud:fraud@localhost:5432/fraud")


class Transaction(BaseModel):
    transaction_id: str
    user_id: str
    receiver_id: Optional[str] = None
    amount: float
    merchant: Optional[str] = None
    channel: str = "card"
    timestamp: Optional[datetime] = None
    features: Dict[str, Any] = Field(default_factory=dict)


class RuleSetInput(BaseModel):
    risk_threshold: float = 0.55
    velocity_limit: int = 4
    high_risk_channels: List[str] = Field(default_factory=lambda: ["wire", "crypto", "upi"])
    balance_delta_org_threshold: float = 2500.0
    balance_delta_dest_threshold: float = 2500.0
    amount_log_threshold: float = 7.0
    amount_to_org_balance_ratio_threshold: float = 0.6
    amount_to_dest_balance_ratio_threshold: float = 1.2
    queue_risk_score_threshold: float = 0.7
    drift_alert_signal_threshold: float = 0.15
    mule_cluster_density_threshold: float = 0.4
    repeated_beneficiary_anomaly_threshold: float = 3.0
    expression_mode: Literal["AND", "OR"] = "AND"
    confidence_weight: float = 0.5
    override_ml_score: bool = False
    shadow_mode: bool = True
    analyst_approval_required: bool = False


class SimRunConfig(BaseModel):
    count: int = Field(default=20, ge=1, le=500)
    start_seconds_ago: int = Field(default=300, ge=0, le=86400)
    max_amount: float = Field(default=3000.0, gt=0, le=1_000_000)
    fraud_ratio: float = Field(default=0.12, ge=0.0, le=1.0)


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


class ItemEnvelopeResponse(BaseModel):
    items: List[Any]
    total: int = 0
    limit: int = 0
    offset: int = 0


class ClusterActionInput(BaseModel):
    action: Literal["expand_cluster", "isolate_cluster", "trace_inbound_funds", "trace_outbound_funds", "mark_mule_ring_suspicious"]


class ThreatEntityActionResponse(BaseModel):
    status: str
    entity_id: str
    case_id: str
    graph: Dict[str, Any] = Field(default_factory=dict)


class CaseActionInput(BaseModel):
    action: Literal["freeze", "escalate", "close", "assign"]
    owner: Optional[str] = None
    reason: Optional[str] = None


class CaseCommentInput(BaseModel):
    author: str
    message: str


class CaseAttachmentInput(BaseModel):
    author: str
    filename: str
    content_type: str = "application/octet-stream"
    payload: str = ""


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.http_client = httpx.AsyncClient(timeout=REQUEST_TIMEOUT_SEC)
    app.state.db = Connection.connect(DATABASE_URL, autocommit=True, row_factory=dict_row)
    db: Connection = app.state.db
    with db.cursor() as cur:
        cur.execute("ALTER TABLE rules_config ADD COLUMN IF NOT EXISTS balance_delta_org_threshold DOUBLE PRECISION NOT NULL DEFAULT 2500")
        cur.execute("ALTER TABLE rules_config ADD COLUMN IF NOT EXISTS balance_delta_dest_threshold DOUBLE PRECISION NOT NULL DEFAULT 2500")
        cur.execute("ALTER TABLE rules_config ADD COLUMN IF NOT EXISTS amount_log_threshold DOUBLE PRECISION NOT NULL DEFAULT 7.0")
        cur.execute("ALTER TABLE rules_config ADD COLUMN IF NOT EXISTS amount_to_org_balance_ratio_threshold DOUBLE PRECISION NOT NULL DEFAULT 0.6")
        cur.execute("ALTER TABLE rules_config ADD COLUMN IF NOT EXISTS amount_to_dest_balance_ratio_threshold DOUBLE PRECISION NOT NULL DEFAULT 1.2")
        cur.execute("ALTER TABLE rules_config ADD COLUMN IF NOT EXISTS queue_risk_score_threshold DOUBLE PRECISION NOT NULL DEFAULT 0.7")
        cur.execute("ALTER TABLE rules_config ADD COLUMN IF NOT EXISTS drift_alert_signal_threshold DOUBLE PRECISION NOT NULL DEFAULT 0.15")
        cur.execute("ALTER TABLE rules_config ADD COLUMN IF NOT EXISTS mule_cluster_density_threshold DOUBLE PRECISION NOT NULL DEFAULT 0.4")
        cur.execute("ALTER TABLE rules_config ADD COLUMN IF NOT EXISTS repeated_beneficiary_anomaly_threshold DOUBLE PRECISION NOT NULL DEFAULT 3.0")
        cur.execute("ALTER TABLE rules_config ADD COLUMN IF NOT EXISTS expression_mode TEXT NOT NULL DEFAULT 'AND'")
        cur.execute("ALTER TABLE rules_config ADD COLUMN IF NOT EXISTS confidence_weight DOUBLE PRECISION NOT NULL DEFAULT 0.5")
        cur.execute("ALTER TABLE rules_config ADD COLUMN IF NOT EXISTS override_ml_score BOOLEAN NOT NULL DEFAULT FALSE")
        cur.execute("ALTER TABLE rules_config ADD COLUMN IF NOT EXISTS shadow_mode BOOLEAN NOT NULL DEFAULT TRUE")
        cur.execute("ALTER TABLE rules_config ADD COLUMN IF NOT EXISTS analyst_approval_required BOOLEAN NOT NULL DEFAULT FALSE")
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS case_comments (
              id BIGSERIAL PRIMARY KEY,
              case_id TEXT NOT NULL,
              author TEXT NOT NULL,
              message TEXT NOT NULL,
              created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
            """
        )
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS case_events (
              id BIGSERIAL PRIMARY KEY,
              case_id TEXT NOT NULL,
              actor TEXT NOT NULL,
              action TEXT NOT NULL,
              details JSONB NOT NULL DEFAULT '{}'::jsonb,
              created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
            """
        )
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS case_attachments (
              id BIGSERIAL PRIMARY KEY,
              case_id TEXT NOT NULL,
              author TEXT NOT NULL,
              filename TEXT NOT NULL,
              content_type TEXT NOT NULL,
              payload TEXT NOT NULL,
              created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
            """
        )
        cur.execute("CREATE INDEX IF NOT EXISTS idx_case_events_case_id ON case_events(case_id, created_at DESC)")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_case_comments_case_id ON case_comments(case_id, created_at DESC)")
    yield
    await app.state.http_client.aclose()
    app.state.db.close()


app = FastAPI(title="Fraud API Gateway", version="0.3.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


async def safe_get_json(url: str, fallback: Any) -> Any:
    try:
        r = await app.state.http_client.get(url)
        r.raise_for_status()
        return r.json()
    except Exception as exc:
        logger.warning("GET %s failed: %s", url, exc)
        return fallback


async def safe_post_json(url: str, payload: dict, fallback: Any) -> Any:
    try:
        r = await app.state.http_client.post(url, json=payload)
        r.raise_for_status()
        return r.json()
    except Exception as exc:
        logger.warning("POST %s failed: %s", url, exc)
        return fallback


def decision_band(label: str, score: float) -> str:
    if label == "fraud" and score >= 0.85:
        return "freeze"
    if label == "fraud" and score >= 0.65:
        return "hold"
    if label == "fraud":
        return "step_up_auth"
    return "approve"


def tx_rows(page: int, limit: int) -> tuple[list[dict], int]:
    db: Connection = app.state.db
    offset = (page - 1) * limit
    with db.cursor() as cur:
        cur.execute("SELECT COUNT(*) AS c FROM transactions")
        total = int(cur.fetchone()["c"])
        cur.execute(
            """
            SELECT transaction_id,user_id,amount,channel,score,label,decision,reasons,rule_score,model_score,timestamp
            FROM transactions
            ORDER BY timestamp DESC
            LIMIT %s OFFSET %s
            """,
            (limit, offset),
        )
        rows = cur.fetchall()
    return rows, total


@app.get("/health", response_model=GatewayHealthResponse)
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


@app.get("/routes", response_model=RoutesResponse)
async def routes() -> RoutesResponse:
    return RoutesResponse(routes=[r.path for r in app.routes])


@app.post("/score", response_model=ScoreResponse)
async def score(tx: Transaction) -> ScoreResponse:
    payload = tx.model_dump(mode="json")
    result = await safe_post_json(f"{ML_INFERENCE_URL}/score", payload, None)
    if result is None:
        raise HTTPException(status_code=503, detail="ml-inference unavailable")

    score_val = float(result.get("score", 0.0))
    label = str(result.get("label", "legit"))
    decision = decision_band(label, score_val)
    ts = (tx.timestamp or datetime.now(timezone.utc)).isoformat().replace("+00:00", "Z")

    enriched: Dict[str, Any] = {
        "transaction_id": tx.transaction_id,
        "user_id": tx.user_id,
        "amount": tx.amount,
        "channel": tx.channel,
        "score": score_val,
        "label": label,
        "decision": decision,
        "reasons": result.get("reasons") or ["baseline"],
        "rule_score": float(result.get("rule_score", 0.0)),
        "model_score": float(result.get("model_score", 0.0)),
        "timestamp": ts,
    }

    await safe_post_json(
        f"{AUDIT_SERVICE_URL}/audits",
        {"actor": "gateway", "action": f"decision:{decision}", "target": tx.transaction_id},
        {},
    )

    if decision in {"hold", "freeze"}:
        await safe_post_json(
            f"{AUDIT_SERVICE_URL}/cases/upsert",
            {
                "id": f"case_{tx.transaction_id}",
                "transaction_id": tx.transaction_id,
                "status": "open",
                "severity": "critical" if decision == "freeze" else "high",
                "owner": "fraud-ops",
                "updated_at": ts,
            },
            {},
        )

    # Ensure graph has sender->receiver (or sender->merchant) directional transfer edge semantics.
    graph_event = {
        "transaction_id": tx.transaction_id,
        "user_id": tx.user_id,
        "receiver_id": tx.receiver_id,
        "merchant": tx.merchant,
        "amount": tx.amount,
        "channel": tx.channel,
        "timestamp": ts,
        "label": label,
        "decision": decision,
        "score": score_val,
    }
    await safe_post_json(f"{GRAPH_SERVICE_URL}/sync-events", {"events": [graph_event]}, {})

    return ScoreResponse(**enriched)


@app.get("/dashboard/overview", response_model=DashboardResponse)
async def dashboard_overview() -> DashboardResponse:
    db: Connection = app.state.db
    with db.cursor() as cur:
        cur.execute(
            """
            SELECT COUNT(*) AS tx_count,
                   COALESCE(AVG(CASE WHEN label='fraud' THEN 1.0 ELSE 0.0 END),0) AS fraud_rate,
                   COALESCE(AVG(score),0) AS avg_score
            FROM transactions
            WHERE timestamp >= NOW() - INTERVAL '24 hours'
            """
        )
        row = cur.fetchone()
        tx_count = int(row["tx_count"])
        fraud_rate = float(row["fraud_rate"])
        avg_score = float(row["avg_score"])

        cur.execute(
            """
            SELECT decision, COUNT(*) AS c
            FROM transactions
            WHERE timestamp >= NOW() - INTERVAL '24 hours'
            GROUP BY decision
            """
        )
        drows = cur.fetchall()

    decision_counts = {r["decision"]: int(r["c"]) for r in drows}

    graph_data = await safe_get_json(
        f"{GRAPH_SERVICE_URL}/overview",
        {"nodes": 0, "edges": 0, "high_risk_nodes": 0, "mule_ring_signals": 0},
    )
    model_ops = await safe_get_json(f"{ML_RETRAIN_SCHEDULER_URL}/model-ops/overview", {})
    open_cases_raw = await safe_get_json(f"{AUDIT_SERVICE_URL}/cases", {"items": []})
    open_cases_count = len(open_cases_raw.get("items", [])) if isinstance(open_cases_raw, dict) else 0

    return DashboardResponse(
        kpis=DashboardKpis(
            transactions_seen=tx_count,
            fraud_rate=round(fraud_rate, 4),
            avg_score=round(avg_score, 4),
            open_cases=open_cases_count,
        ),
        decision_counts=decision_counts,
        graph=graph_data,
        model_ops=DashboardModelOps(
            next_retrain_at=model_ops.get("schedule", {}).get("next_retrain_at"),
            champion=model_ops.get("champion", {}),
            challenger=model_ops.get("challenger", {}),
        ),
    )


@app.get("/transaction-flow/recent", response_model=TransactionFlowResponse)
async def transaction_flow_recent(page: int = 1, limit: int = 50) -> TransactionFlowResponse:
    page = max(1, page)
    limit = max(1, min(limit, 200))
    rows, total = tx_rows(page, limit)
    items = [
        TransactionRecord(
            transaction_id=r["transaction_id"],
            user_id=r["user_id"],
            amount=float(r["amount"]),
            channel=r["channel"],
            score=float(r["score"]),
            label=r["label"],
            decision=r["decision"],
            reasons=r["reasons"] if isinstance(r["reasons"], list) else json.loads(r["reasons"]),
            rule_score=float(r["rule_score"]),
            model_score=float(r["model_score"]),
            timestamp=r["timestamp"].isoformat().replace("+00:00", "Z") if r["timestamp"] else None,
        )
        for r in rows
    ]
    return TransactionFlowResponse(items=items, page=page, limit=limit, total=total)


@app.post("/simulation/run")
async def simulation_run(cfg: SimRunConfig) -> Dict[str, Any]:
    result = await safe_post_json(f"{SIMULATION_ENGINE_URL}/simulate", cfg.model_dump(), None)
    if result is None:
        raise HTTPException(status_code=503, detail="simulation engine unavailable")

    events = result.get("events", [])
    await safe_post_json(f"{GRAPH_SERVICE_URL}/sync-events", {"events": events}, {})

    for i, event in enumerate(events[:200]):
        receiver_id = f"beneficiary_{(i % 11) + 1:02d}"
        if "demo_victim_" in str(event.get("user_id", "")):
            receiver_id = "demo_mule_ring_03"
        elif "demo_mule_ring_03" in str(event.get("user_id", "")):
            receiver_id = "demo_mule_ring_08"
        elif "demo_mule_ring_08" in str(event.get("user_id", "")):
            receiver_id = "sink_account_01"
        tx = {
            "transaction_id": event.get("transaction_id"),
            "user_id": event.get("user_id"),
            "receiver_id": receiver_id,
            "amount": event.get("amount", 0),
            "merchant": event.get("merchant"),
            "channel": event.get("channel", "card"),
            "timestamp": event.get("timestamp"),
            "features": {"velocity": 5 if event.get("label") == "fraud" else 1},
        }
        await safe_post_json(f"{ML_INFERENCE_URL}/score", tx, {})

    return result


@app.get("/simulation/last-run")
async def simulation_last_run() -> Dict[str, Any]:
    return await safe_get_json(f"{SIMULATION_ENGINE_URL}/simulate/last", {})


@app.get("/graph-intelligence/network")
async def graph_network() -> Dict[str, Any]:
    nodes = await safe_get_json(f"{GRAPH_SERVICE_URL}/nodes", [])
    edges = await safe_get_json(f"{GRAPH_SERVICE_URL}/edges", [])
    rings = await safe_get_json(f"{GRAPH_SERVICE_URL}/rings", {"rings": []})
    return {"nodes": nodes, "edges": edges, "rings": rings.get("rings", [])}


@app.get("/graph-intelligence/overview")
async def graph_overview() -> Dict[str, Any]:
    return await safe_get_json(
        f"{GRAPH_SERVICE_URL}/overview",
        {"nodes": 0, "edges": 0, "high_risk_nodes": 0, "mule_ring_signals": 0},
    )


@app.post("/graph-intelligence/clusters/{cluster_id}/action")
async def graph_cluster_action(cluster_id: str, body: ClusterActionInput) -> Dict[str, Any]:
    out = await safe_post_json(f"{GRAPH_SERVICE_URL}/clusters/{cluster_id}/actions", body.model_dump(), None)
    if out is None:
        raise HTTPException(status_code=503, detail="graph service unavailable")
    await safe_post_json(
        f"{AUDIT_SERVICE_URL}/audits",
        {"actor": "graph-ops", "action": f"cluster:{body.action}", "target": cluster_id},
        {},
    )
    return out


@app.post("/threat-entities/{entity_id}/freeze", response_model=ThreatEntityActionResponse)
async def freeze_threat_entity(entity_id: str) -> ThreatEntityActionResponse:
    out = await safe_post_json(f"{GRAPH_SERVICE_URL}/threat-entities/{entity_id}/freeze", {}, None)
    if out is None:
        raise HTTPException(status_code=503, detail="graph service unavailable")
    ts = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    case_id = f"case_freeze_{entity_id}_{int(datetime.now(timezone.utc).timestamp())}"
    await safe_post_json(
        f"{AUDIT_SERVICE_URL}/cases/upsert",
        {
            "id": case_id,
            "transaction_id": f"entity:{entity_id}",
            "status": "open",
            "severity": "critical",
            "owner": "fraud-ops",
            "updated_at": ts,
        },
        {},
    )
    await safe_post_json(
        f"{AUDIT_SERVICE_URL}/audits",
        {"actor": "fraud-ops", "action": "entity_freeze", "target": entity_id},
        {},
    )
    db: Connection = app.state.db
    with db.cursor() as cur:
        cur.execute(
            "INSERT INTO case_events(case_id, actor, action, details, created_at) VALUES (%s,%s,%s,%s::jsonb,NOW())",
            (case_id, "fraud-ops", "freeze", json.dumps({"entity_id": entity_id, "status": "frozen"})),
        )
    return ThreatEntityActionResponse(status="frozen", entity_id=entity_id, case_id=case_id, graph=out)


@app.post("/threat-entities/{entity_id}/rollback", response_model=ThreatEntityActionResponse)
async def rollback_threat_entity(entity_id: str) -> ThreatEntityActionResponse:
    out = await safe_post_json(f"{GRAPH_SERVICE_URL}/threat-entities/{entity_id}/rollback", {}, None)
    if out is None:
        raise HTTPException(status_code=503, detail="graph service unavailable")
    case_id = f"case_rollback_{entity_id}_{int(datetime.now(timezone.utc).timestamp())}"
    await safe_post_json(
        f"{AUDIT_SERVICE_URL}/audits",
        {"actor": "fraud-ops", "action": "entity_rollback", "target": entity_id},
        {},
    )
    return ThreatEntityActionResponse(status="rolled_back", entity_id=entity_id, case_id=case_id, graph=out)


@app.get("/graph-intelligence/replay-path")
async def graph_replay_path(seed: str = "demo_victim_01", limit: int = 20) -> Dict[str, Any]:
    return await safe_get_json(
        f"{GRAPH_SERVICE_URL}/replay-path?seed={seed}&limit={limit}",
        {"steps": [], "total_amount": 0.0, "seed": seed},
    )


@app.get("/model-lab/overview")
async def model_lab_overview() -> Dict[str, Any]:
    return await safe_get_json(
        f"{ML_INFERENCE_URL}/model-lab/overview",
        {"model": {}, "feature_stats": [], "accuracy_curve": [], "drift_baseline": {}},
    )


@app.get("/model-ops/overview")
async def model_ops_overview() -> Dict[str, Any]:
    return await safe_get_json(f"{ML_RETRAIN_SCHEDULER_URL}/model-ops/overview", {})


@app.post("/model-ops/promote")
async def model_ops_promote() -> Dict[str, Any]:
    promoted = await safe_post_json(f"{ML_RETRAIN_SCHEDULER_URL}/model-ops/promote", {}, None)
    if promoted is None:
        raise HTTPException(status_code=503, detail="scheduler unavailable")
    await safe_post_json(
        f"{AUDIT_SERVICE_URL}/audits",
        {"actor": "ml-ops", "action": "promote", "target": promoted.get("champion_version", "unknown")},
        {},
    )
    return promoted


@app.post("/model-ops/rollback")
async def model_ops_rollback() -> Dict[str, Any]:
    rollback = await safe_post_json(f"{ML_RETRAIN_SCHEDULER_URL}/model-ops/rollback", {}, None)
    if rollback is None:
        raise HTTPException(status_code=503, detail="scheduler unavailable")
    await safe_post_json(
        f"{AUDIT_SERVICE_URL}/audits",
        {"actor": "ml-ops", "action": "rollback", "target": rollback.get("champion_version", "unknown")},
        {},
    )
    return rollback


@app.post("/model-ops/retrain-now")
async def model_ops_retrain_now() -> Dict[str, Any]:
    result = await safe_post_json(f"{ML_RETRAIN_SCHEDULER_URL}/model-ops/retrain-now", {}, None)
    if result is None:
        raise HTTPException(status_code=503, detail="scheduler unavailable")
    await safe_post_json(
        f"{AUDIT_SERVICE_URL}/audits",
        {"actor": "ml-ops", "action": "retrain_now", "target": result.get("challenger_version", "unknown")},
        {},
    )
    return result


@app.get("/cases-audit/list", response_model=ItemEnvelopeResponse)
async def cases_audit_list(status: Optional[str] = None, limit: int = 100, offset: int = 0) -> ItemEnvelopeResponse:
    url = f"{AUDIT_SERVICE_URL}/cases?limit={limit}&offset={offset}"
    if status is not None:
        url += f"&status={status}"
    out = await safe_get_json(url, {"items": []})
    if not isinstance(out, dict):
        return ItemEnvelopeResponse(items=[], total=0, limit=limit, offset=offset)
    return ItemEnvelopeResponse(
        items=out.get("items", []),
        total=int(out.get("total", 0)),
        limit=int(out.get("limit", limit)),
        offset=int(out.get("offset", offset)),
    )


@app.get("/cases-audit/audits", response_model=ItemEnvelopeResponse)
async def cases_audit_audits(limit: int = 40, offset: int = 0) -> ItemEnvelopeResponse:
    out = await safe_get_json(f"{AUDIT_SERVICE_URL}/audits?limit={limit}&offset={offset}", {"items": []})
    if not isinstance(out, dict):
        return ItemEnvelopeResponse(items=[], total=0, limit=limit, offset=offset)
    return ItemEnvelopeResponse(
        items=out.get("items", []),
        total=int(out.get("total", 0)),
        limit=int(out.get("limit", limit)),
        offset=int(out.get("offset", offset)),
    )


@app.post("/cases-audit/cases/{case_id}/actions")
async def cases_audit_case_action(case_id: str, body: CaseActionInput) -> Dict[str, Any]:
    if body.action == "freeze":
        entity_id = case_id.replace("case_", "")
        freeze_resp = await freeze_threat_entity(entity_id)
        return {"status": "ok", "action": body.action, "freeze": freeze_resp.model_dump()}
    if body.action == "close":
        status_payload = {"status": "closed"}
    elif body.action == "escalate":
        status_payload = {"status": "escalated"}
    elif body.action == "assign":
        status_payload = {"status": "investigating"}
    else:
        status_payload = {"status": "investigating"}
    try:
        r = await app.state.http_client.patch(f"{AUDIT_SERVICE_URL}/cases/{case_id}/status", json=status_payload)
        r.raise_for_status()
    except Exception as exc:
        logger.warning("case action failed: %s", exc)
        raise HTTPException(status_code=503, detail="audit service unavailable")
    await safe_post_json(
        f"{AUDIT_SERVICE_URL}/audits",
        {"actor": body.owner or "fraud-ops", "action": f"case_{body.action}", "target": case_id},
        {},
    )
    db: Connection = app.state.db
    with db.cursor() as cur:
        cur.execute(
            "INSERT INTO case_events(case_id, actor, action, details, created_at) VALUES (%s,%s,%s,%s::jsonb,NOW())",
            (case_id, body.owner or "fraud-ops", body.action, json.dumps({"reason": body.reason or ""})),
        )
    return {"status": "ok", "action": body.action, "case_id": case_id}


@app.get("/cases-audit/cases/{case_id}/events")
async def cases_audit_case_events(case_id: str) -> Dict[str, Any]:
    db: Connection = app.state.db
    with db.cursor() as cur:
        cur.execute(
            "SELECT id::text, actor, action, details, created_at FROM case_events WHERE case_id=%s ORDER BY created_at DESC LIMIT 200",
            (case_id,),
        )
        rows = cur.fetchall()
    return {"items": rows}


@app.get("/cases-audit/cases/{case_id}/comments")
async def cases_audit_case_comments(case_id: str) -> Dict[str, Any]:
    db: Connection = app.state.db
    with db.cursor() as cur:
        cur.execute(
            "SELECT id::text, author, message, created_at FROM case_comments WHERE case_id=%s ORDER BY created_at DESC LIMIT 200",
            (case_id,),
        )
        rows = cur.fetchall()
    return {"items": rows}


@app.post("/cases-audit/cases/{case_id}/comments")
async def cases_audit_add_comment(case_id: str, body: CaseCommentInput) -> Dict[str, Any]:
    db: Connection = app.state.db
    with db.cursor() as cur:
        cur.execute(
            "INSERT INTO case_comments(case_id, author, message, created_at) VALUES (%s,%s,%s,NOW()) RETURNING id::text, author, message, created_at",
            (case_id, body.author, body.message),
        )
        row = cur.fetchone()
        cur.execute(
            "INSERT INTO case_events(case_id, actor, action, details, created_at) VALUES (%s,%s,%s,%s::jsonb,NOW())",
            (case_id, body.author, "comment", json.dumps({"message": body.message})),
        )
    return {"status": "ok", "comment": row}


@app.post("/cases-audit/cases/{case_id}/attachments")
async def cases_audit_add_attachment(case_id: str, body: CaseAttachmentInput) -> Dict[str, Any]:
    db: Connection = app.state.db
    with db.cursor() as cur:
        cur.execute(
            """
            INSERT INTO case_attachments(case_id, author, filename, content_type, payload, created_at)
            VALUES (%s,%s,%s,%s,%s,NOW())
            RETURNING id::text, filename, content_type, created_at
            """,
            (case_id, body.author, body.filename, body.content_type, body.payload),
        )
        row = cur.fetchone()
        cur.execute(
            "INSERT INTO case_events(case_id, actor, action, details, created_at) VALUES (%s,%s,%s,%s::jsonb,NOW())",
            (case_id, body.author, "attachment_upload", json.dumps({"filename": body.filename})),
        )
    return {"status": "ok", "attachment": row}


@app.get("/cases-audit/queue/stream")
async def cases_audit_queue_stream() -> Dict[str, Any]:
    out = await safe_get_json(f"{AUDIT_SERVICE_URL}/cases?limit=200&offset=0", {"items": []})
    items = out.get("items", []) if isinstance(out, dict) else []
    priority = []
    for idx, c in enumerate(items):
        sev = str(c.get("severity", "low"))
        weight = 4 if sev == "critical" else 3 if sev == "high" else 2 if sev == "medium" else 1
        priority.append({"case_id": c.get("id"), "queue_priority_score": weight * 100 - idx})
    return {"items": priority, "updated_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")}


@app.get("/cases-audit/audits/export")
async def cases_audit_export(format: str = Query(default="csv", pattern="^(csv|json)$")):
    out = await safe_get_json(f"{AUDIT_SERVICE_URL}/audits?limit=1000&offset=0", {"items": []})
    items = out.get("items", []) if isinstance(out, dict) else []
    if format == "json":
        return JSONResponse(content={"items": items})
    buff = io.StringIO()
    writer = csv.DictWriter(buff, fieldnames=["id", "actor", "action", "target", "timestamp"])
    writer.writeheader()
    for row in items:
        writer.writerow(
            {
                "id": row.get("id"),
                "actor": row.get("actor"),
                "action": row.get("action"),
                "target": row.get("target"),
                "timestamp": row.get("timestamp"),
            }
        )
    buff.seek(0)
    return StreamingResponse(buff, media_type="text/csv", headers={"Content-Disposition": "attachment; filename=audit_export.csv"})


@app.get("/rule-studio/rules", response_model=RuleStudioResponse)
async def rule_studio_rules() -> RuleStudioResponse:
    db: Connection = app.state.db
    with db.cursor() as cur:
        cur.execute(
            """
            SELECT
              risk_threshold, velocity_limit, high_risk_channels,
              balance_delta_org_threshold, balance_delta_dest_threshold, amount_log_threshold,
              amount_to_org_balance_ratio_threshold, amount_to_dest_balance_ratio_threshold,
              queue_risk_score_threshold, drift_alert_signal_threshold, mule_cluster_density_threshold,
              repeated_beneficiary_anomaly_threshold, expression_mode, confidence_weight,
              override_ml_score, shadow_mode, analyst_approval_required
            FROM rules_config WHERE id=1
            """
        )
        row = cur.fetchone()
    return RuleStudioResponse(rules=row if row else RuleSetInput().model_dump())


@app.post("/rule-studio/rules/evaluate", response_model=RuleEvalResponse)
async def rule_studio_evaluate(rule_set: RuleSetInput) -> RuleEvalResponse:
    db: Connection = app.state.db
    with db.cursor() as cur:
        cur.execute(
            """
            UPDATE rules_config
            SET risk_threshold=%s,
                velocity_limit=%s,
                high_risk_channels=%s::jsonb,
                balance_delta_org_threshold=%s,
                balance_delta_dest_threshold=%s,
                amount_log_threshold=%s,
                amount_to_org_balance_ratio_threshold=%s,
                amount_to_dest_balance_ratio_threshold=%s,
                queue_risk_score_threshold=%s,
                drift_alert_signal_threshold=%s,
                mule_cluster_density_threshold=%s,
                repeated_beneficiary_anomaly_threshold=%s,
                expression_mode=%s,
                confidence_weight=%s,
                override_ml_score=%s,
                shadow_mode=%s,
                analyst_approval_required=%s,
                updated_at=NOW()
            WHERE id=1
            """,
            (
                rule_set.risk_threshold,
                rule_set.velocity_limit,
                json.dumps(rule_set.high_risk_channels),
                rule_set.balance_delta_org_threshold,
                rule_set.balance_delta_dest_threshold,
                rule_set.amount_log_threshold,
                rule_set.amount_to_org_balance_ratio_threshold,
                rule_set.amount_to_dest_balance_ratio_threshold,
                rule_set.queue_risk_score_threshold,
                rule_set.drift_alert_signal_threshold,
                rule_set.mule_cluster_density_threshold,
                rule_set.repeated_beneficiary_anomaly_threshold,
                rule_set.expression_mode,
                rule_set.confidence_weight,
                rule_set.override_ml_score,
                rule_set.shadow_mode,
                rule_set.analyst_approval_required,
            ),
        )
    await safe_post_json(
        f"{AUDIT_SERVICE_URL}/audits",
        {"actor": "rule-studio", "action": "rules_evaluate", "target": "rules_config_v2"},
        {},
    )
    return RuleEvalResponse(status="accepted", rules=rule_set.model_dump(), note="Persisted to PostgreSQL rules_config")


@app.post("/explain")
async def explain(tx: Transaction) -> Dict[str, Any]:
    result = await safe_post_json(f"{ML_INFERENCE_URL}/explain", tx.model_dump(mode="json"), None)
    if result is None:
        raise HTTPException(status_code=503, detail="ml-inference unavailable")
    return result


@app.post("/batch-score")
async def batch_score(body: List[Dict[str, Any]]) -> Dict[str, Any]:
    try:
        r = await app.state.http_client.post(f"{ML_INFERENCE_URL}/batch-score", json=body)
        r.raise_for_status()
        return r.json()
    except Exception as exc:
        logger.warning("batch-score proxy failed: %s", exc)
        raise HTTPException(status_code=503, detail="ml-inference unavailable")


@app.post("/simulation/run-preset/demo-final")
async def simulation_run_preset_demo_final() -> Dict[str, Any]:
    """Deterministic demo scenario — same 200-account fraud story every run."""
    _ARCHETYPE_VELOCITY: Dict[str, int] = {
        "mule_ring": 8,
        "cross_border_smurfing": 7,
        "account_takeover": 9,
        "velocity_burst": 12,
        "synthetic_identity": 6,
        "friendly_fraud": 4,
        "merchant_collusion": 6,
        "normal_behavior": 1,
    }

    result = await safe_post_json(f"{SIMULATION_ENGINE_URL}/simulate/preset/demo-final", {}, None)
    if result is None:
        raise HTTPException(status_code=503, detail="simulation engine unavailable")

    events = result.get("events", [])
    await safe_post_json(f"{GRAPH_SERVICE_URL}/sync-events", {"events": events}, {})

    for i, event in enumerate(events[:300]):
        archetype = event.get("archetype", "normal_behavior")
        velocity = _ARCHETYPE_VELOCITY.get(archetype, 2)
        raw_merchant = event.get("merchant") or ""
        src = str(event.get("user_id", ""))
        receiver_id = f"beneficiary_{(i % 13) + 1:02d}"
        if "demo_victim_" in src:
            receiver_id = "demo_mule_ring_03"
        elif "demo_mule_ring_03" in src:
            receiver_id = "demo_mule_ring_08"
        elif "demo_mule_ring_08" in src:
            receiver_id = "sink_account_01"
        tx: Dict[str, Any] = {
            "transaction_id": event.get("transaction_id"),
            "user_id": event.get("user_id"),
            "receiver_id": receiver_id,
            "amount": event.get("amount", 0),
            "merchant": raw_merchant if raw_merchant else None,
            "channel": event.get("channel", "card"),
            "timestamp": event.get("timestamp"),
            "features": {"velocity": velocity},
        }
        await safe_post_json(f"{ML_INFERENCE_URL}/score", tx, {})

    return result



@app.get("/simulation/archetypes/detail")
async def simulation_archetypes_detail() -> Dict[str, Any]:
    result = await safe_get_json(f"{SIMULATION_ENGINE_URL}/archetypes/detail", [])
    return {"archetypes": result}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)

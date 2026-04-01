from contextlib import asynccontextmanager
from datetime import datetime
import os
from typing import Any, Dict, List, Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
import httpx
from pydantic import BaseModel, Field


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


ML_INFERENCE_URL = os.getenv("ML_INFERENCE_URL", "http://localhost:8500").rstrip("/")
ML_RETRAIN_SCHEDULER_URL = os.getenv("ML_RETRAIN_SCHEDULER_URL", "http://localhost:8700").rstrip("/")
SIMULATION_ENGINE_URL = os.getenv("SIMULATION_ENGINE_URL", "http://localhost:8600").rstrip("/")
GRAPH_SERVICE_URL = os.getenv("GRAPH_SERVICE_URL", "http://localhost:8900").rstrip("/")
AUDIT_SERVICE_URL = os.getenv("AUDIT_SERVICE_URL", "http://localhost:8800").rstrip("/")
REQUEST_TIMEOUT_SEC = float(os.getenv("REQUEST_TIMEOUT_SEC", "3"))


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.http_client = httpx.AsyncClient(timeout=REQUEST_TIMEOUT_SEC)
    app.state.recent_transactions = []
    app.state.last_simulation = {"events": [], "summary": {"generated": 0, "fraud": 0, "legit": 0}}
    app.state.rule_set = RuleSetInput()
    yield
    await app.state.http_client.aclose()


app = FastAPI(title="Fraud API Gateway", version="0.2.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


async def safe_get_json(url: str, fallback: Any) -> Any:
    try:
        resp = await app.state.http_client.get(url)
        resp.raise_for_status()
        return resp.json()
    except Exception:
        return fallback


async def safe_post_json(url: str, payload: dict, fallback: Any) -> Any:
    try:
        resp = await app.state.http_client.post(url, json=payload)
        resp.raise_for_status()
        return resp.json()
    except Exception:
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


@app.get("/health")
async def health() -> dict:
    inference = await safe_get_json(f"{ML_INFERENCE_URL}/health", {"status": "degraded"})
    scheduler = await safe_get_json(f"{ML_RETRAIN_SCHEDULER_URL}/health", {"status": "degraded"})
    simulation = await safe_get_json(f"{SIMULATION_ENGINE_URL}/health", {"status": "degraded"})
    graph = await safe_get_json(f"{GRAPH_SERVICE_URL}/health", {"status": "degraded"})
    audit = await safe_get_json(f"{AUDIT_SERVICE_URL}/health", {"status": "degraded"})

    return {
        "status": "ok",
        "inference_status": inference.get("status", "degraded"),
        "scheduler_status": scheduler.get("status", "degraded"),
        "simulation_status": simulation.get("status", "degraded"),
        "graph_status": graph.get("status", "degraded"),
        "audit_status": audit.get("status", "degraded"),
        "services": {
            "ml_inference": ML_INFERENCE_URL,
            "ml_retrain_scheduler": ML_RETRAIN_SCHEDULER_URL,
            "simulation_engine": SIMULATION_ENGINE_URL,
            "graph_service": GRAPH_SERVICE_URL,
            "audit_service": AUDIT_SERVICE_URL,
        },
    }


@app.get("/routes")
async def routes() -> dict:
    return {"routes": [r.path for r in app.routes]}


@app.post("/score")
async def score(tx: Transaction) -> dict:
    payload = tx.model_dump(mode="json")
    result = await safe_post_json(f"{ML_INFERENCE_URL}/score", payload, None)
    if result is None:
        raise HTTPException(status_code=503, detail="ml-inference unavailable")

    score_val = float(result.get("score", 0.0))
    label = str(result.get("label", "legit"))
    decision = decision_band(label, score_val)

    enriched = {
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
        "timestamp": datetime.utcnow().isoformat() + "Z",
    }

    app.state.recent_transactions.insert(0, enriched)
    del app.state.recent_transactions[150:]

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
            "updated_at": datetime.utcnow().isoformat() + "Z",
        }
        await safe_post_json(f"{AUDIT_SERVICE_URL}/cases/upsert", case_payload, {})

    return enriched


@app.get("/dashboard/overview")
async def dashboard_overview() -> dict:
    recent = app.state.recent_transactions[:30]
    fraud = len([item for item in recent if item["label"] == "fraud"])
    tx_count = len(recent)
    decision_counts: Dict[str, int] = {}
    for item in recent:
        decision_counts[item["decision"]] = decision_counts.get(item["decision"], 0) + 1

    graph = await safe_get_json(f"{GRAPH_SERVICE_URL}/overview", {})
    model_ops = await safe_get_json(f"{ML_RETRAIN_SCHEDULER_URL}/model-ops/overview", {})

    return {
        "kpis": {
            "transactions_seen": tx_count,
            "fraud_rate": round((fraud / tx_count), 4) if tx_count else 0.0,
            "avg_score": round(sum(item["score"] for item in recent) / tx_count, 4) if tx_count else 0.0,
            "open_cases": len(await safe_get_json(f"{AUDIT_SERVICE_URL}/cases", [])),
        },
        "decision_counts": decision_counts,
        "graph": graph,
        "model_ops": {
            "next_retrain_at": model_ops.get("schedule", {}).get("next_retrain_at"),
            "champion": model_ops.get("champion", {}),
            "challenger": model_ops.get("challenger", {}),
        },
    }


@app.get("/transaction-flow/recent")
async def transaction_flow_recent() -> dict:
    return {"items": app.state.recent_transactions[:60]}


@app.post("/simulation/run")
async def simulation_run(cfg: dict) -> dict:
    result = await safe_post_json(f"{SIMULATION_ENGINE_URL}/simulate", cfg, None)
    if result is None:
        raise HTTPException(status_code=503, detail="simulation engine unavailable")

    events = result.get("events", [])
    app.state.last_simulation = result

    await safe_post_json(f"{GRAPH_SERVICE_URL}/sync-events", {"events": events}, {})

    for event in events[:80]:
        app.state.recent_transactions.insert(
            0,
            {
                "transaction_id": event.get("transaction_id"),
                "user_id": event.get("user_id"),
                "amount": event.get("amount", 0),
                "channel": event.get("channel", "card"),
                "score": 0.82 if event.get("label") == "fraud" else 0.18,
                "label": event.get("label", "legit"),
                "decision": "hold" if event.get("label") == "fraud" else "approve",
                "reasons": [event.get("archetype", "simulation")],
                "rule_score": 0.7 if event.get("label") == "fraud" else 0.2,
                "model_score": 0.78 if event.get("label") == "fraud" else 0.21,
                "timestamp": event.get("timestamp"),
            },
        )

    del app.state.recent_transactions[150:]
    return result


@app.get("/simulation/last-run")
async def simulation_last_run() -> dict:
    return app.state.last_simulation


@app.get("/graph-intelligence/network")
async def graph_network() -> dict:
    nodes = await safe_get_json(f"{GRAPH_SERVICE_URL}/nodes", [])
    edges = await safe_get_json(f"{GRAPH_SERVICE_URL}/edges", [])
    rings = await safe_get_json(f"{GRAPH_SERVICE_URL}/rings", {"rings": []})
    return {"nodes": nodes, "edges": edges, "rings": rings.get("rings", [])}


@app.get("/graph-intelligence/overview")
async def graph_overview() -> dict:
    return await safe_get_json(f"{GRAPH_SERVICE_URL}/overview", {"nodes": 0, "edges": 0, "high_risk_nodes": 0})


@app.get("/model-lab/overview")
async def model_lab_overview() -> dict:
    return await safe_get_json(
        f"{ML_INFERENCE_URL}/model-lab/overview",
        {"model": {}, "feature_stats": [], "accuracy_curve": [], "drift_baseline": {}},
    )


@app.get("/model-ops/overview")
async def model_ops_overview() -> dict:
    return await safe_get_json(f"{ML_RETRAIN_SCHEDULER_URL}/model-ops/overview", {})


@app.post("/model-ops/promote")
async def model_ops_promote() -> dict:
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
async def model_ops_rollback() -> dict:
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
async def model_ops_retrain_now() -> dict:
    result = await safe_post_json(f"{ML_RETRAIN_SCHEDULER_URL}/model-ops/retrain-now", {}, None)
    if result is None:
        raise HTTPException(status_code=503, detail="scheduler unavailable")
    await safe_post_json(
        f"{AUDIT_SERVICE_URL}/audits",
        {"actor": "ml-ops", "action": "retrain_now", "target": result.get("challenger_version", "unknown")},
        {},
    )
    return result


@app.get("/cases-audit/list")
async def cases_audit_list() -> dict:
    return {"items": await safe_get_json(f"{AUDIT_SERVICE_URL}/cases", [])}


@app.get("/cases-audit/audits")
async def cases_audit_audits() -> dict:
    return {"items": await safe_get_json(f"{AUDIT_SERVICE_URL}/audits", [])}


@app.get("/rule-studio/rules")
async def rule_studio_rules() -> dict:
    return {"rules": app.state.rule_set.model_dump()}


@app.post("/rule-studio/rules/evaluate")
async def rule_studio_evaluate(rule_set: RuleSetInput) -> dict:
    app.state.rule_set = rule_set
    return {
        "status": "accepted",
        "rules": rule_set.model_dump(),
        "note": "Simulation-only rule tuning; production rules are not mutated in this demo",
    }


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)

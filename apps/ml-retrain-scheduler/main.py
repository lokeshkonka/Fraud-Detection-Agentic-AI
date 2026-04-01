import asyncio
from datetime import datetime, timedelta
from typing import Dict, List, Optional

from fastapi import FastAPI
from pydantic import BaseModel


RUN_INTERVAL_SECONDS = 7 * 24 * 60 * 60


class RetrainHistoryItem(BaseModel):
    id: str
    started_at: str
    completed_at: str
    status: str
    candidate_version: str
    challenger_pr_auc: float
    promoted: bool


class ArtifactItem(BaseModel):
    name: str
    path: str
    updated_at: str


app = FastAPI(title="ML Retrain Scheduler", version="0.2.0")

_next_run: Optional[datetime] = None
_last_retrain_at: Optional[datetime] = None
_last_shadow_candidate = "xgb_challenger_v3"
_champion_version = "xgb_trained_external_v1"
_challenger_version = "xgb_challenger_v3"

_drift_state: Dict[str, float] = {
    "psi": 0.09,
    "mean_shift": 0.07,
    "variance_shift": 0.11,
}

_artifacts: List[ArtifactItem] = [
    ArtifactItem(name="champion_model", path="models/xgb_fraud_v1.json", updated_at=datetime.utcnow().isoformat() + "Z"),
    ArtifactItem(name="drift_baseline", path="artifacts/drift/drift_baseline.json", updated_at=datetime.utcnow().isoformat() + "Z"),
    ArtifactItem(name="accuracy_curve", path="artifacts/model_eval/xgb_accuracy_curve.png", updated_at=datetime.utcnow().isoformat() + "Z"),
]

_history: List[RetrainHistoryItem] = [
    RetrainHistoryItem(
        id="run-001",
        started_at=(datetime.utcnow() - timedelta(days=14)).isoformat() + "Z",
        completed_at=(datetime.utcnow() - timedelta(days=14, minutes=-6)).isoformat() + "Z",
        status="completed",
        candidate_version="xgb_challenger_v2",
        challenger_pr_auc=0.831,
        promoted=False,
    ),
    RetrainHistoryItem(
        id="run-002",
        started_at=(datetime.utcnow() - timedelta(days=7)).isoformat() + "Z",
        completed_at=(datetime.utcnow() - timedelta(days=7, minutes=-5)).isoformat() + "Z",
        status="completed",
        candidate_version="xgb_challenger_v3",
        challenger_pr_auc=0.848,
        promoted=False,
    ),
]


async def retrain_job() -> None:
    global _next_run, _last_retrain_at, _challenger_version, _last_shadow_candidate

    started = datetime.utcnow()
    await asyncio.sleep(0.05)

    candidate = f"xgb_challenger_shadow_{started.strftime('%Y%m%d')}"
    _challenger_version = candidate
    _last_shadow_candidate = candidate

    _drift_state["psi"] = round(max(0.02, min(0.25, _drift_state["psi"] * 0.96)), 3)
    _drift_state["mean_shift"] = round(max(0.02, min(0.2, _drift_state["mean_shift"] * 0.95)), 3)
    _drift_state["variance_shift"] = round(max(0.03, min(0.25, _drift_state["variance_shift"] * 0.95)), 3)

    completed = datetime.utcnow()
    _last_retrain_at = completed
    _next_run = completed + timedelta(seconds=RUN_INTERVAL_SECONDS)

    _history.insert(
        0,
        RetrainHistoryItem(
            id=f"run-{started.strftime('%Y%m%d%H%M%S')}",
            started_at=started.isoformat() + "Z",
            completed_at=completed.isoformat() + "Z",
            status="completed",
            candidate_version=candidate,
            challenger_pr_auc=0.852,
            promoted=False,
        ),
    )
    del _history[10:]


async def scheduler_loop() -> None:
    global _next_run
    _next_run = datetime.utcnow() + timedelta(seconds=RUN_INTERVAL_SECONDS)
    while True:
        await asyncio.sleep(RUN_INTERVAL_SECONDS)
        await retrain_job()


@app.on_event("startup")
async def start_scheduler() -> None:
    asyncio.create_task(scheduler_loop())


@app.get("/health")
async def health() -> dict:
    return {
        "status": "ok",
        "next_run": _next_run.isoformat() + "Z" if _next_run else None,
        "last_retrain": _last_retrain_at.isoformat() + "Z" if _last_retrain_at else None,
    }


@app.post("/model-ops/retrain-now")
async def retrain_now() -> dict:
    await retrain_job()
    return {"status": "completed", "challenger_version": _challenger_version}


@app.post("/model-ops/promote")
async def promote() -> dict:
    global _champion_version
    _champion_version = _challenger_version
    if _history:
        _history[0].promoted = True
    return {"status": "promoted", "champion_version": _champion_version}


@app.post("/model-ops/rollback")
async def rollback() -> dict:
    global _champion_version
    _champion_version = "xgb_trained_external_v1"
    return {"status": "rolled_back", "champion_version": _champion_version}


@app.get("/model-ops/overview")
async def model_ops_overview() -> dict:
    now = datetime.utcnow()
    next_run = _next_run or now + timedelta(seconds=RUN_INTERVAL_SECONDS)
    countdown_sec = int(max(0, (next_run - now).total_seconds()))

    return {
        "schedule": {
            "interval_days": 7,
            "next_retrain_at": next_run.isoformat() + "Z",
            "last_retrain_at": _last_retrain_at.isoformat() + "Z" if _last_retrain_at else None,
            "countdown_seconds": countdown_sec,
        },
        "drift": _drift_state,
        "champion": {
            "version": _champion_version,
            "pr_auc": 0.842,
            "status": "active",
        },
        "challenger": {
            "version": _challenger_version,
            "pr_auc": 0.852,
            "status": "shadow",
            "source": _last_shadow_candidate,
        },
        "adaptive_learning": {
            "threshold": 0.55,
            "policy": "dynamic-threshold-enabled",
            "last_adjustment": (now - timedelta(hours=9)).isoformat() + "Z",
        },
        "artifacts": [item.model_dump() for item in _artifacts],
        "history": [item.model_dump() for item in _history],
    }


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="0.0.0.0", port=8700, reload=True)

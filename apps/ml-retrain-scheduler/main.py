import asyncio
import logging
from datetime import datetime, timedelta
from typing import Dict, List, Optional

from fastapi import FastAPI
from pydantic import BaseModel, ConfigDict

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)
logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

RUN_INTERVAL_SECONDS = 7 * 24 * 60 * 60

# ---------------------------------------------------------------------------
# Domain models
# ---------------------------------------------------------------------------


class RetrainHistoryItem(BaseModel):
    model_config = ConfigDict(json_encoders={datetime: lambda v: v.isoformat() + "Z"})

    id: str
    started_at: datetime
    completed_at: datetime
    status: str
    candidate_version: str
    challenger_pr_auc: float
    promoted: bool


class ArtifactItem(BaseModel):
    model_config = ConfigDict(json_encoders={datetime: lambda v: v.isoformat() + "Z"})

    name: str
    path: str
    updated_at: datetime


# ---------------------------------------------------------------------------
# Response models
# ---------------------------------------------------------------------------


class HealthResponse(BaseModel):
    model_config = ConfigDict(json_encoders={datetime: lambda v: v.isoformat() + "Z"})

    status: str
    next_run: Optional[datetime] = None
    last_retrain: Optional[datetime] = None


class ScheduleInfo(BaseModel):
    model_config = ConfigDict(json_encoders={datetime: lambda v: v.isoformat() + "Z"})

    interval_days: int
    next_retrain_at: datetime
    last_retrain_at: Optional[datetime] = None
    countdown_seconds: int


class DriftInfo(BaseModel):
    psi: float
    mean_shift: float
    variance_shift: float


class ModelVersionInfo(BaseModel):
    version: str
    pr_auc: float
    status: str
    source: Optional[str] = None


class AdaptiveLearningInfo(BaseModel):
    model_config = ConfigDict(json_encoders={datetime: lambda v: v.isoformat() + "Z"})

    threshold: float
    policy: str
    last_adjustment: datetime


class ModelOpsOverviewResponse(BaseModel):
    model_config = ConfigDict(json_encoders={datetime: lambda v: v.isoformat() + "Z"})

    schedule: ScheduleInfo
    drift: DriftInfo
    champion: ModelVersionInfo
    challenger: ModelVersionInfo
    adaptive_learning: AdaptiveLearningInfo
    artifacts: List[ArtifactItem]
    history: List[RetrainHistoryItem]


class PromoteResponse(BaseModel):
    status: str
    champion_version: str


class RollbackResponse(BaseModel):
    status: str
    champion_version: str


class RetrainResponse(BaseModel):
    status: str
    challenger_version: str


class HistoryResponse(BaseModel):
    items: List[RetrainHistoryItem]


class ArtifactsResponse(BaseModel):
    items: List[ArtifactItem]


# ---------------------------------------------------------------------------
# In-memory state
# ---------------------------------------------------------------------------

_next_run: Optional[datetime] = None
_last_retrain_at: Optional[datetime] = None
_last_shadow_candidate = "xgb_challenger_v3"
_champion_version = "xgb_trained_external_v1"
_challenger_version = "xgb_challenger_v3"

_drift_state: DriftInfo = DriftInfo(psi=0.09, mean_shift=0.07, variance_shift=0.11)

_artifacts: List[ArtifactItem] = [
    ArtifactItem(
        name="champion_model",
        path="models/xgb_fraud_v1.json",
        updated_at=datetime.utcnow(),
    ),
    ArtifactItem(
        name="drift_baseline",
        path="artifacts/drift/drift_baseline.json",
        updated_at=datetime.utcnow(),
    ),
    ArtifactItem(
        name="accuracy_curve",
        path="artifacts/model_eval/xgb_accuracy_curve.png",
        updated_at=datetime.utcnow(),
    ),
]

_history: List[RetrainHistoryItem] = [
    RetrainHistoryItem(
        id="run-001",
        started_at=datetime.utcnow() - timedelta(days=14),
        completed_at=datetime.utcnow() - timedelta(days=14) + timedelta(minutes=6),
        status="completed",
        candidate_version="xgb_challenger_v2",
        challenger_pr_auc=0.831,
        promoted=False,
    ),
    RetrainHistoryItem(
        id="run-002",
        started_at=datetime.utcnow() - timedelta(days=7),
        completed_at=datetime.utcnow() - timedelta(days=7) + timedelta(minutes=5),
        status="completed",
        candidate_version="xgb_challenger_v3",
        challenger_pr_auc=0.848,
        promoted=False,
    ),
]

# ---------------------------------------------------------------------------
# Retrain logic
# ---------------------------------------------------------------------------


async def retrain_job() -> None:
    global _next_run, _last_retrain_at, _challenger_version, _last_shadow_candidate, _drift_state

    started = datetime.utcnow()
    logger.info("retrain job started at %s", started.isoformat())
    await asyncio.sleep(0.05)

    candidate = f"xgb_challenger_shadow_{started.strftime('%Y%m%d')}"
    _challenger_version = candidate
    _last_shadow_candidate = candidate

    _drift_state = DriftInfo(
        psi=round(max(0.02, min(0.25, _drift_state.psi * 0.96)), 3),
        mean_shift=round(max(0.02, min(0.20, _drift_state.mean_shift * 0.95)), 3),
        variance_shift=round(max(0.03, min(0.25, _drift_state.variance_shift * 0.95)), 3),
    )

    completed = datetime.utcnow()
    _last_retrain_at = completed
    _next_run = completed + timedelta(seconds=RUN_INTERVAL_SECONDS)

    _history.insert(
        0,
        RetrainHistoryItem(
            id=f"run-{started.strftime('%Y%m%d%H%M%S')}",
            started_at=started,
            completed_at=completed,
            status="completed",
            candidate_version=candidate,
            challenger_pr_auc=0.852,
            promoted=False,
        ),
    )
    del _history[10:]
    logger.info("retrain job completed; challenger=%s", candidate)


async def scheduler_loop() -> None:
    global _next_run
    _next_run = datetime.utcnow()
    while True:
        await retrain_job()
        await asyncio.sleep(RUN_INTERVAL_SECONDS)


# ---------------------------------------------------------------------------
# App
# ---------------------------------------------------------------------------

app = FastAPI(title="ML Retrain Scheduler", version="0.2.0")


@app.on_event("startup")
async def start_scheduler() -> None:
    asyncio.create_task(scheduler_loop())


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------


@app.get(
    "/health",
    response_model=HealthResponse,
    tags=["health"],
    summary="Scheduler liveness, next scheduled run, and last retrain timestamp",
)
async def health() -> HealthResponse:
    return HealthResponse(
        status="ok",
        next_run=_next_run,
        last_retrain=_last_retrain_at,
    )


@app.post(
    "/model-ops/retrain-now",
    response_model=RetrainResponse,
    tags=["model-ops"],
    summary="Trigger an immediate out-of-schedule retrain cycle",
)
async def retrain_now() -> RetrainResponse:
    logger.info("manual retrain triggered")
    await retrain_job()
    return RetrainResponse(status="completed", challenger_version=_challenger_version)


@app.post(
    "/model-ops/promote",
    response_model=PromoteResponse,
    tags=["model-ops"],
    summary="Promote the shadow challenger to production champion",
)
async def promote() -> PromoteResponse:
    global _champion_version
    _champion_version = _challenger_version
    if _history:
        _history[0].promoted = True
    logger.info("model promoted: %s", _champion_version)
    return PromoteResponse(status="promoted", champion_version=_champion_version)


@app.post(
    "/model-ops/rollback",
    response_model=RollbackResponse,
    tags=["model-ops"],
    summary="Roll back champion to the stable baseline version",
)
async def rollback() -> RollbackResponse:
    global _champion_version
    _champion_version = "xgb_trained_external_v1"
    logger.info("model rolled back to %s", _champion_version)
    return RollbackResponse(status="rolled_back", champion_version=_champion_version)


@app.get(
    "/model-ops/overview",
    response_model=ModelOpsOverviewResponse,
    tags=["model-ops"],
    summary="Full model-ops overview: schedule, drift, champion/challenger, artifacts, history",
)
async def model_ops_overview() -> ModelOpsOverviewResponse:
    now = datetime.utcnow()
    next_run = _next_run or now + timedelta(seconds=RUN_INTERVAL_SECONDS)
    countdown_sec = int(max(0, (next_run - now).total_seconds()))

    return ModelOpsOverviewResponse(
        schedule=ScheduleInfo(
            interval_days=7,
            next_retrain_at=next_run,
            last_retrain_at=_last_retrain_at,
            countdown_seconds=countdown_sec,
        ),
        drift=_drift_state,
        champion=ModelVersionInfo(
            version=_champion_version,
            pr_auc=0.842,
            status="active",
        ),
        challenger=ModelVersionInfo(
            version=_challenger_version,
            pr_auc=0.852,
            status="shadow",
            source=_last_shadow_candidate,
        ),
        adaptive_learning=AdaptiveLearningInfo(
            threshold=0.55,
            policy="dynamic-threshold-enabled",
            last_adjustment=now - timedelta(hours=9),
        ),
        artifacts=_artifacts,
        history=_history,
    )


@app.get(
    "/history",
    response_model=HistoryResponse,
    tags=["model-ops"],
    summary="Paginated retrain history records",
)
async def retrain_history(limit: int = 10) -> HistoryResponse:
    limit = max(1, min(limit, 100))
    return HistoryResponse(items=_history[:limit])


@app.get(
    "/artifacts",
    response_model=ArtifactsResponse,
    tags=["model-ops"],
    summary="List persisted model and evaluation artifacts",
)
async def retrain_artifacts() -> ArtifactsResponse:
    return ArtifactsResponse(items=_artifacts)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="0.0.0.0", port=8700, reload=True)

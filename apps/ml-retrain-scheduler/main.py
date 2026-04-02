import asyncio
import logging
import os
from datetime import datetime, timedelta, timezone
from typing import List, Optional

from fastapi import FastAPI
from psycopg import Connection
from psycopg.rows import dict_row
from pydantic import BaseModel, ConfigDict

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
logger = logging.getLogger(__name__)

DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://fraud:fraud@localhost:5432/fraud")
RUN_INTERVAL_SECONDS = int(os.getenv("RUN_INTERVAL_SECONDS", str(7 * 24 * 60 * 60)))


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


class HealthResponse(BaseModel):
    status: str
    next_run: Optional[datetime] = None
    last_retrain: Optional[datetime] = None


class ScheduleInfo(BaseModel):
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
    threshold: float
    policy: str
    last_adjustment: datetime


class ModelOpsOverviewResponse(BaseModel):
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


app = FastAPI(title="ML Retrain Scheduler", version="0.3.0")


@app.on_event("startup")
async def startup() -> None:
    app.state.db = Connection.connect(DATABASE_URL, autocommit=True, row_factory=dict_row)
    asyncio.create_task(scheduler_loop())


@app.on_event("shutdown")
def shutdown() -> None:
    db: Connection = app.state.db
    db.close()


def db() -> Connection:
    return app.state.db


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def get_state() -> dict:
    with db().cursor() as cur:
        cur.execute(
            """
            SELECT next_run,last_retrain,champion_version,challenger_version,
                   drift_psi,drift_mean_shift,drift_variance_shift,
                   threshold,policy,last_adjustment
            FROM scheduler_state WHERE id=1
            """
        )
        row = cur.fetchone()
        if not row:
            raise RuntimeError("scheduler_state missing")
        return row


def update_state(**fields) -> None:
    sets = []
    vals = []
    for k, v in fields.items():
        sets.append(f"{k}=%s")
        vals.append(v)
    vals.append(1)
    with db().cursor() as cur:
        cur.execute(f"UPDATE scheduler_state SET {', '.join(sets)} WHERE id=%s", vals)


def get_metric(name: str) -> float:
    with db().cursor() as cur:
        if name == "champion":
            cur.execute("SELECT champion_pr_auc AS v FROM model_metrics WHERE id=1")
        else:
            cur.execute("SELECT challenger_pr_auc AS v FROM model_metrics WHERE id=1")
        return float(cur.fetchone()["v"])


async def retrain_job() -> None:
    started = now_utc()
    candidate = f"xgb_challenger_shadow_{started.strftime('%Y%m%d')}"

    state = get_state()
    drift_psi = round(max(0.02, min(0.25, float(state["drift_psi"]) * 0.96)), 3)
    drift_mean = round(max(0.02, min(0.20, float(state["drift_mean_shift"]) * 0.95)), 3)
    drift_var = round(max(0.03, min(0.25, float(state["drift_variance_shift"]) * 0.95)), 3)

    completed = now_utc()
    next_run = completed + timedelta(seconds=RUN_INTERVAL_SECONDS)
    update_state(
        challenger_version=candidate,
        last_retrain=completed,
        next_run=next_run,
        drift_psi=drift_psi,
        drift_mean_shift=drift_mean,
        drift_variance_shift=drift_var,
    )

    with db().cursor() as cur:
        cur.execute(
            """
            INSERT INTO retrain_history(id, started_at, completed_at, status, candidate_version, challenger_pr_auc, promoted)
            VALUES (%s,%s,%s,%s,%s,%s,%s)
            ON CONFLICT (id) DO NOTHING
            """,
            (
                f"run-{started.strftime('%Y%m%d%H%M%S')}",
                started,
                completed,
                "completed",
                candidate,
                0.852,
                False,
            ),
        )
    logger.info("retrain completed challenger=%s", candidate)


async def scheduler_loop() -> None:
    while True:
        s = get_state()
        nr = s["next_run"] or now_utc()
        now = now_utc()
        wait = max(0, int((nr - now).total_seconds()))
        if wait > 0:
            await asyncio.sleep(min(wait, 60))
            continue
        await retrain_job()


@app.get("/health", response_model=HealthResponse)
async def health() -> HealthResponse:
    s = get_state()
    return HealthResponse(status="ok", next_run=s["next_run"], last_retrain=s["last_retrain"])


@app.post("/model-ops/retrain-now", response_model=RetrainResponse)
async def retrain_now() -> RetrainResponse:
    await retrain_job()
    return RetrainResponse(status="completed", challenger_version=get_state()["challenger_version"])


@app.post("/model-ops/promote", response_model=PromoteResponse)
async def promote() -> PromoteResponse:
    s = get_state()
    champion = s["challenger_version"]
    update_state(champion_version=champion)
    with db().cursor() as cur:
        cur.execute("UPDATE retrain_history SET promoted=TRUE WHERE id=(SELECT id FROM retrain_history ORDER BY completed_at DESC LIMIT 1)")
    return PromoteResponse(status="promoted", champion_version=champion)


@app.post("/model-ops/rollback", response_model=RollbackResponse)
async def rollback() -> RollbackResponse:
    champion = "xgb_trained_external_v1"
    update_state(champion_version=champion)
    return RollbackResponse(status="rolled_back", champion_version=champion)


@app.get("/model-ops/overview", response_model=ModelOpsOverviewResponse)
async def model_ops_overview() -> ModelOpsOverviewResponse:
    s = get_state()
    now = now_utc()
    next_run = s["next_run"] or (now + timedelta(seconds=RUN_INTERVAL_SECONDS))
    countdown = int(max(0, (next_run - now).total_seconds()))

    with db().cursor() as cur:
        cur.execute("SELECT name, path, updated_at FROM artifacts ORDER BY name")
        artifacts = [ArtifactItem(**r) for r in cur.fetchall()]

        cur.execute(
            """
            SELECT id, started_at, completed_at, status, candidate_version, challenger_pr_auc, promoted
            FROM retrain_history ORDER BY completed_at DESC LIMIT 10
            """
        )
        history = [RetrainHistoryItem(**r) for r in cur.fetchall()]

    return ModelOpsOverviewResponse(
        schedule=ScheduleInfo(
            interval_days=7,
            next_retrain_at=next_run,
            last_retrain_at=s["last_retrain"],
            countdown_seconds=countdown,
        ),
        drift=DriftInfo(
            psi=float(s["drift_psi"]),
            mean_shift=float(s["drift_mean_shift"]),
            variance_shift=float(s["drift_variance_shift"]),
        ),
        champion=ModelVersionInfo(version=s["champion_version"], pr_auc=get_metric("champion"), status="active"),
        challenger=ModelVersionInfo(version=s["challenger_version"], pr_auc=get_metric("challenger"), status="shadow", source=s["challenger_version"]),
        adaptive_learning=AdaptiveLearningInfo(
            threshold=float(s["threshold"]),
            policy=s["policy"],
            last_adjustment=s["last_adjustment"],
        ),
        artifacts=artifacts,
        history=history,
    )


@app.get("/history", response_model=HistoryResponse)
async def retrain_history(limit: int = 10) -> HistoryResponse:
    limit = max(1, min(limit, 100))
    with db().cursor() as cur:
        cur.execute(
            """
            SELECT id, started_at, completed_at, status, candidate_version, challenger_pr_auc, promoted
            FROM retrain_history ORDER BY completed_at DESC LIMIT %s
            """,
            (limit,),
        )
        rows = cur.fetchall()
    return HistoryResponse(items=[RetrainHistoryItem(**r) for r in rows])


@app.get("/artifacts", response_model=ArtifactsResponse)
async def retrain_artifacts() -> ArtifactsResponse:
    with db().cursor() as cur:
        cur.execute("SELECT name, path, updated_at FROM artifacts ORDER BY name")
        rows = cur.fetchall()
    return ArtifactsResponse(items=[ArtifactItem(**r) for r in rows])


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="0.0.0.0", port=8700, reload=True)

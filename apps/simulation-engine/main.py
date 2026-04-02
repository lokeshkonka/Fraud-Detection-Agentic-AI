import logging
import os
import random
import string
from datetime import datetime, timedelta, timezone
from typing import Dict, List

from fastapi import FastAPI, HTTPException
from psycopg import Connection
from psycopg.rows import dict_row
from pydantic import BaseModel, Field

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
logger = logging.getLogger(__name__)

DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://fraud:fraud@localhost:5432/fraud")


class SimConfig(BaseModel):
    count: int = Field(default=20, ge=1, le=500)
    start_seconds_ago: int = Field(default=300, ge=0, le=86400)
    max_amount: float = Field(default=3000.0, gt=0, le=1_000_000)
    fraud_ratio: float = Field(default=0.12, ge=0.0, le=1.0)


class SimEvent(BaseModel):
    transaction_id: str
    user_id: str
    amount: float
    merchant: str
    channel: str
    timestamp: datetime
    label: str
    archetype: str


class SimSummary(BaseModel):
    generated: int
    fraud: int
    legit: int
    fraud_ratio: float


class SimRunResponse(BaseModel):
    events: List[SimEvent]
    summary: SimSummary
    generated_at: datetime


class ArchetypeInfo(BaseModel):
    id: str
    description: str
    risk_level: str


class ArchetypesResponse(BaseModel):
    archetypes: List[str]


class HealthResponse(BaseModel):
    status: str
    archetypes: List[str]


app = FastAPI(title="Simulation Engine", version="0.3.0")

EMPTY_LAST_RUN = {
    "events": [],
    "summary": {"generated": 0, "fraud": 0, "legit": 0, "fraud_ratio": 0.0},
}


@app.on_event("startup")
def startup() -> None:
    app.state.db = Connection.connect(DATABASE_URL, autocommit=True, row_factory=dict_row)


@app.on_event("shutdown")
def shutdown() -> None:
    db: Connection = app.state.db
    db.close()


def _id(prefix: str = "txn") -> str:
    return f"{prefix}_" + "".join(random.choices(string.ascii_lowercase + string.digits, k=10))


def load_catalog(table: str, col: str) -> List[str]:
    db: Connection = app.state.db
    with db.cursor() as cur:
        cur.execute(f"SELECT {col} FROM {table} ORDER BY {col}")
        return [r[col] for r in cur.fetchall()]


def _event(now: datetime, max_amount: float, is_fraud: bool, channels: List[str], merchants: List[str], archetypes: List[str]) -> SimEvent:
    if not channels or not merchants:
        raise HTTPException(status_code=500, detail="catalog tables not seeded")

    channel = random.choice(channels)
    merchant = random.choice(merchants)
    amount = round(random.uniform(5, max_amount), 2)

    if is_fraud:
        high_risk = [c for c in channels if c in {"wire", "crypto", "upi"}] or channels
        channel = random.choice(high_risk)
        amount = round(random.uniform(max_amount * 0.45, max_amount), 2)

    return SimEvent(
        transaction_id=_id(),
        user_id=_id("user"),
        amount=amount,
        merchant=merchant,
        channel=channel,
        timestamp=now - timedelta(seconds=random.randint(0, 300)),
        label="fraud" if is_fraud else "legit",
        archetype=random.choice(archetypes) if is_fraud else "normal_behavior",
    )


def save_run(run_id: str, generated_at: datetime, summary: SimSummary, events: List[SimEvent]) -> None:
    db: Connection = app.state.db
    with db.cursor() as cur:
        cur.execute(
            """
            INSERT INTO simulation_runs(run_id, generated_at, generated, fraud, legit, fraud_ratio)
            VALUES (%s,%s,%s,%s,%s,%s)
            """,
            (run_id, generated_at, summary.generated, summary.fraud, summary.legit, summary.fraud_ratio),
        )
        for e in events:
            cur.execute(
                """
                INSERT INTO simulation_events(run_id, transaction_id, user_id, amount, merchant, channel, timestamp, label, archetype)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)
                """,
                (run_id, e.transaction_id, e.user_id, e.amount, e.merchant, e.channel, e.timestamp, e.label, e.archetype),
            )


@app.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    archetypes = load_catalog("fraud_archetypes", "id")
    return HealthResponse(status="ok", archetypes=archetypes)


@app.get("/archetypes", response_model=ArchetypesResponse)
def archetypes() -> ArchetypesResponse:
    return ArchetypesResponse(archetypes=load_catalog("fraud_archetypes", "id"))


@app.get("/archetypes/detail", response_model=List[ArchetypeInfo])
def archetypes_detail() -> List[ArchetypeInfo]:
    db: Connection = app.state.db
    with db.cursor() as cur:
        cur.execute("SELECT id, description, risk_level FROM fraud_archetypes ORDER BY id")
        rows = cur.fetchall()
    return [ArchetypeInfo(**r) for r in rows]


@app.post("/simulate", response_model=SimRunResponse)
async def simulate(cfg: SimConfig) -> SimRunResponse:
    now = datetime.now(timezone.utc)
    channels = load_catalog("channel_catalog", "channel")
    merchants = load_catalog("merchant_catalog", "merchant")
    archetypes = load_catalog("fraud_archetypes", "id")

    count = max(1, min(cfg.count, 500))
    fraud_ratio = max(0.0, min(cfg.fraud_ratio, 1.0))
    events: List[SimEvent] = []
    for _ in range(count):
        events.append(_event(now, cfg.max_amount, random.random() < fraud_ratio, channels, merchants, archetypes))

    fraud_count = len([e for e in events if e.label == "fraud"])
    summary = SimSummary(generated=count, fraud=fraud_count, legit=count - fraud_count, fraud_ratio=round(fraud_count / count, 4))
    generated_at = datetime.now(timezone.utc)
    run_id = f"run_{generated_at.strftime('%Y%m%d%H%M%S')}_{random.randint(100,999)}"

    save_run(run_id, generated_at, summary, events)
    logger.info("simulation complete run=%s count=%d fraud=%d", run_id, count, fraud_count)
    return SimRunResponse(events=events, summary=summary, generated_at=generated_at)


@app.get("/simulate/last")
async def last_run() -> Dict:
    db: Connection = app.state.db
    with db.cursor() as cur:
        cur.execute("SELECT run_id, generated_at, generated, fraud, legit, fraud_ratio FROM simulation_runs ORDER BY generated_at DESC LIMIT 1")
        run = cur.fetchone()
        if not run:
            return {**EMPTY_LAST_RUN, "generated_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")}

        cur.execute(
            """
            SELECT transaction_id, user_id, amount, merchant, channel, timestamp, label, archetype
            FROM simulation_events WHERE run_id=%s ORDER BY id
            """,
            (run["run_id"],),
        )
        events = cur.fetchall()

    return {
        "events": [{**e, "timestamp": e["timestamp"].isoformat().replace("+00:00", "Z")} for e in events],
        "summary": {
            "generated": run["generated"],
            "fraud": run["fraud"],
            "legit": run["legit"],
            "fraud_ratio": float(run["fraud_ratio"]),
        },
        "generated_at": run["generated_at"].isoformat().replace("+00:00", "Z"),
    }


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="0.0.0.0", port=8600, reload=True)

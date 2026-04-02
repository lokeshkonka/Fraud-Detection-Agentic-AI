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


DEMO_SEED = 12345
DEMO_RUN_ID = "run_demo_final_preset"


def _make_txn_id(rng: random.Random, prefix: str) -> str:
    return f"{prefix}_" + "".join(rng.choices(string.ascii_lowercase + string.digits, k=10))


@app.post("/simulate/preset/demo-final", response_model=SimRunResponse)
async def simulate_demo_preset() -> SimRunResponse:
    """Deterministic, seed-locked demo scenario. Always produces the same story."""
    rng = random.Random(DEMO_SEED)
    now = datetime.now(timezone.utc)
    events: List[SimEvent] = []

    # ── Ring 1: Phoenix — wire-fraud mule ring, 5 accounts × 5 events ──────
    for i in range(1, 6):
        uid = f"demo_ring_phoenix_{i:02d}"
        for j in range(5):
            events.append(SimEvent(
                transaction_id=_make_txn_id(rng, f"phoenix_{i:02d}_{j}"),
                user_id=uid,
                amount=round(rng.uniform(4500, 9800), 2),
                merchant="wallet_topup",
                channel="wire",
                timestamp=now - timedelta(seconds=rng.randint(0, 7200)),
                label="fraud",
                archetype="mule_ring",
            ))

    # ── Ring 2: Atlas — crypto smurfing, 5 accounts × 3 events ─────────────
    for i in range(1, 6):
        uid = f"demo_ring_atlas_{i:02d}"
        for j in range(3):
            events.append(SimEvent(
                transaction_id=_make_txn_id(rng, f"atlas_{i:02d}_{j}"),
                user_id=uid,
                amount=round(rng.uniform(2000, 4900), 2),
                merchant="gaming",
                channel="crypto",
                timestamp=now - timedelta(seconds=rng.randint(0, 3600)),
                label="fraud",
                archetype="cross_border_smurfing",
            ))

    # ── Ring 3: Vortex — account takeover, 4 accounts × 3 events ───────────
    for i in range(1, 5):
        uid = f"demo_ring_vortex_{i:02d}"
        for j in range(3):
            events.append(SimEvent(
                transaction_id=_make_txn_id(rng, f"vortex_{i:02d}_{j}"),
                user_id=uid,
                amount=round(rng.uniform(7000, 9500), 2),
                merchant="electronics",
                channel="wire",
                timestamp=now - timedelta(seconds=rng.randint(60, 1800)),
                label="fraud",
                archetype="account_takeover",
            ))

    # ── Geo burst — 1 account, 12 card transactions in 30 seconds ───────────
    geo_uid = "demo_geo_burst_01"
    for j in range(12):
        events.append(SimEvent(
            transaction_id=_make_txn_id(rng, f"geo_{j}"),
            user_id=geo_uid,
            amount=round(rng.uniform(100, 800), 2),
            merchant="fuel",
            channel="card",
            timestamp=now - timedelta(seconds=max(1, 30 - j * 2)),
            label="fraud",
            archetype="velocity_burst",
        ))

    # ── Device sharing — 5 accounts, same merchant, 3 events each ───────────
    for i in range(1, 6):
        uid = f"demo_device_share_{i:02d}"
        for j in range(3):
            events.append(SimEvent(
                transaction_id=_make_txn_id(rng, f"devshare_{i:02d}_{j}"),
                user_id=uid,
                amount=round(rng.uniform(800, 2500), 2),
                merchant="electronics",
                channel="card",
                timestamp=now - timedelta(seconds=rng.randint(60, 300)),
                label="fraud",
                archetype="synthetic_identity",
            ))

    # ── 2 explicit freeze-level events (wire, very high amount) ─────────────
    for i, amt in enumerate([9750.0, 9200.0], start=1):
        events.append(SimEvent(
            transaction_id=_make_txn_id(rng, f"freeze_{i}"),
            user_id=f"demo_freeze_target_{i:02d}",
            amount=amt,
            merchant="wallet_topup",
            channel="wire",
            timestamp=now - timedelta(seconds=rng.randint(30, 600)),
            label="fraud",
            archetype="account_takeover",
        ))

    # ── 1 OTP trigger (step_up_auth — card, low amount, missing merchant) ───
    events.append(SimEvent(
        transaction_id=_make_txn_id(rng, "otp_01"),
        user_id="demo_otp_user_01",
        amount=350.0,
        merchant="",
        channel="card",
        timestamp=now - timedelta(seconds=120),
        label="fraud",
        archetype="friendly_fraud",
    ))

    # ── 1 Hold → case escalation (ach, medium amount, missing merchant) ─────
    events.append(SimEvent(
        transaction_id=_make_txn_id(rng, "hold_01"),
        user_id="demo_hold_user_01",
        amount=3200.0,
        merchant="",
        channel="ach",
        timestamp=now - timedelta(seconds=240),
        label="fraud",
        archetype="merchant_collusion",
    ))

    fraud_count = len(events)

    # ── 176 legit accounts (1 transaction each) — rounds to 200 accounts ────
    legit_merchants = ["groceries", "travel", "healthcare", "fashion", "fuel"]
    legit_channels = ["card", "ach"]
    for i in range(1, 177):
        events.append(SimEvent(
            transaction_id=_make_txn_id(rng, f"legit_{i:03d}"),
            user_id=f"demo_legit_{i:03d}",
            amount=round(rng.uniform(10, 1500), 2),
            merchant=rng.choice(legit_merchants),
            channel=rng.choice(legit_channels),
            timestamp=now - timedelta(seconds=rng.randint(0, 86400)),
            label="legit",
            archetype="normal_behavior",
        ))

    legit_count = len(events) - fraud_count
    total = len(events)
    summary = SimSummary(
        generated=total,
        fraud=fraud_count,
        legit=legit_count,
        fraud_ratio=round(fraud_count / total, 4),
    )

    # Idempotent: delete previous preset run (cascade deletes events)
    db: Connection = app.state.db
    with db.cursor() as cur:
        cur.execute("DELETE FROM simulation_runs WHERE run_id=%s", (DEMO_RUN_ID,))

    save_run(DEMO_RUN_ID, now, summary, events)
    logger.info(
        "demo preset complete run_id=%s accounts=%d fraud=%d legit=%d total=%d",
        DEMO_RUN_ID, len(set(e.user_id for e in events)), fraud_count, legit_count, total,
    )
    return SimRunResponse(events=events, summary=summary, generated_at=now)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="0.0.0.0", port=8600, reload=True)

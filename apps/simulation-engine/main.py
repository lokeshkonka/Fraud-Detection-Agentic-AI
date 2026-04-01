import random
import string
from datetime import datetime, timedelta
from typing import Dict, List

from fastapi import FastAPI
from pydantic import BaseModel, Field


class SimConfig(BaseModel):
    count: int = Field(default=20, ge=1, le=500)
    start_seconds_ago: int = Field(default=300, ge=0, le=86400)
    max_amount: float = Field(default=3000.0, gt=0, le=1000000)
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


FRAUD_ARCHETYPES = [
    "mule_ring",
    "account_takeover",
    "friendly_fraud",
    "cross_border_smurfing",
    "merchant_collusion",
    "synthetic_identity",
    "velocity_burst",
]

CHANNELS = ["card", "wire", "crypto", "ach", "upi"]
MERCHANTS = ["groceries", "travel", "electronics", "fashion", "gaming", "wallet_topup"]

app = FastAPI(title="Simulation Engine", version="0.2.0")


_last_run: Dict[str, object] = {
    "events": [],
    "summary": {
        "generated": 0,
        "fraud": 0,
        "legit": 0,
    },
}


def _id(prefix: str = "txn") -> str:
    suffix = "".join(random.choices(string.ascii_lowercase + string.digits, k=10))
    return f"{prefix}_{suffix}"


def _archetype(is_fraud: bool) -> str:
    if not is_fraud:
        return "normal_behavior"
    return random.choice(FRAUD_ARCHETYPES)


def _event(now: datetime, max_amount: float, is_fraud: bool) -> SimEvent:
    channel = random.choice(CHANNELS)
    amount = round(random.uniform(5, max_amount), 2)

    if is_fraud:
        channel = random.choice(["wire", "crypto", "upi"])
        amount = round(random.uniform(max_amount * 0.45, max_amount), 2)

    return SimEvent(
        transaction_id=_id(),
        user_id=_id("user"),
        amount=amount,
        merchant=random.choice(MERCHANTS),
        channel=channel,
        timestamp=now - timedelta(seconds=random.randint(0, 300)),
        label="fraud" if is_fraud else "legit",
        archetype=_archetype(is_fraud),
    )


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "archetypes": FRAUD_ARCHETYPES}


@app.get("/archetypes")
def archetypes() -> dict:
    return {"archetypes": FRAUD_ARCHETYPES}


@app.post("/simulate")
async def simulate(cfg: SimConfig) -> dict:
    now = datetime.utcnow()
    count = max(1, min(cfg.count, 500))
    fraud_ratio = max(0.0, min(cfg.fraud_ratio, 1.0))

    events: List[SimEvent] = []
    for _ in range(count):
        is_fraud = random.random() < fraud_ratio
        events.append(_event(now, cfg.max_amount, is_fraud))

    fraud_count = len([item for item in events if item.label == "fraud"])
    payload = {
        "events": [item.model_dump(mode="json") for item in events],
        "summary": {
            "generated": count,
            "fraud": fraud_count,
            "legit": count - fraud_count,
            "fraud_ratio": round(fraud_count / count, 4),
        },
    }

    _last_run["events"] = payload["events"]
    _last_run["summary"] = payload["summary"]
    _last_run["generated_at"] = datetime.utcnow().isoformat() + "Z"
    return payload


@app.get("/simulate/last")
async def last_run() -> dict:
    return _last_run


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="0.0.0.0", port=8600, reload=True)

import random
import string
from datetime import datetime, timedelta
from typing import List

from fastapi import FastAPI
from pydantic import BaseModel


class SimConfig(BaseModel):
    count: int = 10
    start_seconds_ago: int = 300
    max_amount: float = 2000.0


class SimEvent(BaseModel):
    transaction_id: str
    user_id: str
    amount: float
    merchant: str
    channel: str
    timestamp: datetime
    label: str


app = FastAPI(title="Simulation Engine", version="0.1.0")

CHANNELS = ["card", "wire", "crypto", "ach"]
MERCHANTS = ["groceries", "travel", "electronics", "fashion", "gaming"]


def _id(prefix: str = "txn") -> str:
    suffix = "".join(random.choices(string.ascii_lowercase + string.digits, k=10))
    return f"{prefix}_{suffix}"


def _event(now: datetime, max_amount: float) -> SimEvent:
    amount = round(random.uniform(5, max_amount), 2)
    channel = random.choice(CHANNELS)
    label = "fraud" if channel in {"wire", "crypto"} and amount > 500 else "legit"
    return SimEvent(
        transaction_id=_id(),
        user_id=_id("user"),
        amount=amount,
        merchant=random.choice(MERCHANTS),
        channel=channel,
        timestamp=now - timedelta(seconds=random.randint(0, 300)),
        label=label,
    )


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


@app.post("/simulate", response_model=List[SimEvent])
async def simulate(cfg: SimConfig) -> List[SimEvent]:
    now = datetime.utcnow()
    return [_event(now, cfg.max_amount) for _ in range(cfg.count)]


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="0.0.0.0", port=8600, reload=True)

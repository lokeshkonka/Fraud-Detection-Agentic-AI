from datetime import datetime
import random
from typing import List, Optional

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field


class Transaction(BaseModel):
    transaction_id: str
    user_id: str
    amount: float
    merchant: Optional[str] = None
    channel: str = "card"
    timestamp: Optional[datetime] = None
    features: dict = Field(default_factory=dict)


class ScoreResponse(BaseModel):
    score: float
    label: str
    reasons: List[str]


app = FastAPI(title="Fraud API Gateway", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


def heuristic_score(tx: Transaction) -> ScoreResponse:
    base = min(0.99, 0.02 + (tx.amount / 10000))
    reasons: List[str] = []

    if tx.channel in {"wire", "crypto"}:
        base += 0.12
        reasons.append("high_risk_channel")
    if tx.merchant is None:
        base += 0.05
        reasons.append("missing_merchant")
    if tx.features.get("velocity", 0) > 3:
        base += 0.08
        reasons.append("high_velocity")

    jitter = random.uniform(-0.02, 0.02)
    score = max(0.0, min(0.99, base + jitter))
    label = "fraud" if score >= 0.5 else "legit"

    return ScoreResponse(score=round(score, 4), label=label, reasons=reasons or ["baseline"])


@app.post("/score", response_model=ScoreResponse)
async def score(tx: Transaction) -> ScoreResponse:
    # TODO: route to ml-inference service once available
    return heuristic_score(tx)


@app.get("/routes")
async def routes() -> dict:
    return {"routes": [r.path for r in app.routes]}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
